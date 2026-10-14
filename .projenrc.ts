import { ProjenTypeScriptProject } from '@gammarers/projen-projects';
const project = new ProjenTypeScriptProject({
  name: 'fetch-retrier',
  repositoryUrl: 'https://github.com/gammarers-labs/fetch-retrier.git',
  description: 'Retry-enabled fetch wrapper with per-attempt timeout, Retry-After support, full-jitter backoff, and option validation.',
  devDeps: [
    '@gammarers/projen-projects@^0.5.8',
  ],
  releaseToNpm: true,
  npmTrustedPublishing: true,
});
project.synth();