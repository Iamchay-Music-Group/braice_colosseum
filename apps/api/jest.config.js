module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    // uuid@14 (reached via @solana/web3.js -> rpc-websockets) ships ESM only.
    // Jest ignores node_modules by default and has no JS transformer
    // configured, so it chokes on `export` while loading @solana/web3.js.
    // Transforming it here is what lets the blockchain tests exercise the real
    // PDA derivation and encoding instead of mocking them away. Forcing an
    // older CJS uuid was rejected: rpc-websockets declares uuid@^14, so a
    // downgrade would misrepresent the dependency graph.
    '^.+\\.m?js$': [
      'babel-jest',
      { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
    ],
  },
  // The `.*uuid/` form matches pnpm's nested .pnpm store layout, where the
  // package directory is not directly under the first node_modules.
  transformIgnorePatterns: ['/node_modules/(?!.*uuid/)'],
  collectCoverageFrom: ['**/*.ts', '!main.ts', '!**/*.module.ts', '!**/*.dto.ts', '!**/*.entity.ts', '!**/*.interface.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
