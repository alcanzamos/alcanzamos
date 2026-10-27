// Reglas del título del PR (E17-ECO 2.4): tipos en inglés, ámbito = carpeta del monorepo,
// descripción en español. Lo que queda en main es el título del PR (fusión por squash).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'docs', 'test', 'refactor', 'perf', 'build', 'ci', 'chore']],
    'scope-enum': [2, 'always', ['api', 'web', 'movil', 'reglas', 'diseno', 'infra', 'docs', 'marca']],
    'subject-case': [0],
    'header-max-length': [2, 'always', 150],
  },
};
