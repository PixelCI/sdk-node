export type Config = {
  apiKey?: string;
  projectHandle?: string;
  clientSessionId?: string;

  branch?: string;
  commitSha?: string;
  pullRequestNumber?: string;
};

let cachedConfig: Config | null = null;

export function getEnvConfig() {
  if (cachedConfig !== null) return cachedConfig;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ciEnv = require('ci-env');
    // env = process.env;

    cachedConfig = {
      apiKey: process.env.PIXELCI_API_KEY,
      clientSessionId: process.env.PIXELCI_CLIENT_SESSION_ID,
      projectHandle: process.env.PIXELCI_CLIENT_PROJECT_HANDLE,

      branch: ciEnv.branch,
      commitSha: ciEnv.sha,
      pullRequestNumber: ciEnv.pull_request_number,
    };
    return cachedConfig!;
  } catch (e) {
    // on a browser, move along
    cachedConfig = {};
    return cachedConfig!;
  }
}
