import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PermissionsService } from './modules/permissions/permissions.service';
import { AuditService } from './modules/audit/audit.service';
import { AuditController } from './modules/audit/audit.controller';

/**
 * A DataSource shaped like the real one, without a connection.
 *
 * @nestjs/typeorm builds one repository provider per entity and each one
 * dereferences `dataSource.entityMetadatas.find(...)` and `dataSource.options`
 * while DI resolves. A bare `{}` override therefore fails with "cannot read
 * properties of undefined (reading 'find')" — which looks like a wiring bug
 * and is not. These four members are the entire surface that gets touched
 * before init() is called.
 */
function stubDataSource(): Record<string, unknown> {
  return {
    entityMetadatas: [],
    options: { type: 'postgres' },
    isInitialized: true,
    destroy: async () => undefined,
    getRepository: () => ({}),
    getTreeRepository: () => ({}),
    getMongoRepository: () => ({}),
  };
}

/**
 * The module graph compiles.
 *
 * Every other spec in this repo builds a testing module by hand with hand-picked
 * providers, which is the right way to test behaviour and the wrong way to test
 * wiring: those modules are assembled by the test, not by the app. This one
 * imports the real AppModule, so it exercises the imports each feature module
 * actually declares.
 *
 * It exists because of a real failure. AuditController injected
 * PermissionsService while AuditModule deliberately did not import
 * PermissionsModule — PermissionsModule already imports AuditModule to record
 * revocation events, and a back-reference would have been a cycle. Typecheck
 * passed, all 339 unit tests passed, and the service would not start:
 *
 *   Nest can't resolve dependencies of the AuditController (AuditService, ?)
 *
 * A test suite that is green on a service that cannot boot is worse than no
 * test suite, because it reports the work as finished. This is the assertion
 * that it is finished.
 *
 * Only the database is stubbed. Overriding anything else would rebuild the
 * graph instead of checking it, which defeats the purpose.
 */
describe('AppModule wiring', () => {
  let appModule: typeof import('./app.module').AppModule;

  beforeAll(async () => {
    // ConfigModule.forRoot runs when app.module.ts is first evaluated, and its
    // validate() deliberately throws on a missing JWT_SECRET. That is correct
    // for a boot and wrong for a test, so the value is set before the import
    // rather than the validator being relaxed.
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'test-secret-at-least-32-characters-long';

    // Required after the assignment above, hence the dynamic import.
    ({ AppModule: appModule } = await import('./app.module'));
  });

  it('resolves every provider and controller dependency', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [appModule],
    })
      // TypeOrmModule.forRootAsync is the only piece that would open a socket
      // pool. DI resolves during compile(); init() is what connects, and this
      // spec never calls it.
      .overrideProvider(DataSource)
      .useValue(stubDataSource())
      .compile();

    expect(moduleRef).toBeDefined();

    // Reaching this line is the assertion: compile() throws on an unsatisfied
    // dependency rather than deferring it to the first request.
    await moduleRef.close();
  });

  it('keeps the audit/permissions dependency pointing one way', () => {
    // The cycle is asymmetric, which is why it is worth pinning explicitly.
    // AuditModule must not import PermissionsModule; PermissionsModule does
    // import AuditModule, to record PERMISSION_REVOKED. The back-reference
    // resolves fine in a compile of AuditModule on its own and only breaks
    // once both are loaded into the app, which is precisely the outage this
    // file documents.
    //
    // The check is on the controller's constructor, because that is where the
    // unresolvable injection lived: anything AuditController needs must be
    // reachable from AuditModule, and PermissionsService is the one thing
    // AuditModule deliberately cannot provide.
    const injected = Reflect.getMetadata(
      'design:paramtypes',
      AuditController,
    ) as unknown[];

    expect(injected).toContain(AuditService);
    expect(injected).not.toContain(PermissionsService);
  });
});
