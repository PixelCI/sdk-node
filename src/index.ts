import Client from './client'

export type SessionManagerConfig = {
  apiKey: string
  projectSlug: string
  sessionKey?: string
  tags?: { [str: string]: string }
}

export class SessionManager {
  protected client: Client
  protected testSessionId: string
  protected capturePromises: Array<Promise<any>> = []

  constructor(protected config: SessionManagerConfig) {
    this.client = new Client(config.apiKey)
  }

  async open() {
    const [tenantSlug, projectSlug] = this.config.projectSlug.split('/')
    const { project } = await this.client.request(`query {
      project: projectBySlug(
        tenantSlug: "${tenantSlug}",
        projectSlug: "${projectSlug}"
      ) {
        id
      }
    }`)

    const { openSession } = await this.client.request(`mutation {
      openSession(input: {
        projectId: "${project}",
        clientId: "${this.config.sessionKey}",
      }) {
        testSession {
          id
        }
      }
    }`)

    this.testSessionId = openSession.testSession.id
  }

  close() {
    return this.client.request(`mutation {
      closeSession(input: {
        id: "${this.testSessionId}"
      }) {
        __typename
      }
    }`)
  }

  createCheck(imageData: Buffer, name: string, tags?: { [str: string]: string }) {
    if (!this.testSessionId) throw new Error('`.open` must be called first')

    tags = tags || {}
    tags = { ...this.config.tags, ...tags }

    this.capturePromises.push(
      this.client.request(`mutation {
      createImageCheck(input: {
        testSessionId: "${this.testSessionId}",
        data: "${imageData.toString('base64')}",
        name: "${name}",
        tags: ${JSON.stringify(tags)}
      }) {
        imageCheck {
          name
        }
      }
    }`),
    )
  }
}

export class SeleniumSessionManager extends SessionManager {
  private browser

  constructor({ browser, ...config }: SessionManagerConfig & { browser: any }) {
    super(config)
    this.browser = browser
  }

  async capture(name: string, tags?: { [str: string]: string }) {
    const imageData = await this.browser.takeScreenshot()
    this.createCheck(imageData, name, tags)
  }
}
