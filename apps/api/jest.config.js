module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.ts', '!main.ts', '!**/*.module.ts', '!**/*.dto.ts', '!**/*.entity.ts', '!**/*.interface.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
