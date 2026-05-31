import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  replace: {
    // Some consumers complain when import.meta is used, even when it's
    // emitted only in the .mjs entrypoint (looking at you CodeSandbox)
    'import.meta.env?.MODE': 'process.env.NODE_ENV',
  },
});
