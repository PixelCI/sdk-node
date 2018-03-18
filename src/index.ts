import * as t from 'io-ts'
// tslint:disable-next-line:no-implicit-dependencies
import { WebDriver } from 'selenium-webdriver'
import Client from './client'
import { validateArgs } from './utils'

export const TagsType = t.dictionary(t.string, t.string)
export type Tags = t.TypeOf<typeof TagsType>

export const SessionManagerConfigType = t.interface({
  apiKey: t.string,
  projectSlug: t.string,
  sessionKey: t.union([t.string, t.undefined]),
  tags: t.union([TagsType, t.undefined]),
})
export type SessionManagerConfig = t.TypeOf<typeof SessionManagerConfigType>

export class SessionManager {
  protected client: Client
  protected testSessionId: string
  protected capturePromises: Array<Promise<any>> = []

  constructor(protected config: SessionManagerConfig) {
    validateArgs({
      config: [SessionManagerConfigType, config],
    })

    this.client = new Client(config.apiKey)
  }

  async open() {
    const [tenantSlug, projectSlug] = this.config.projectSlug.split('/')
    const { project } = await this.client.request(`query {
      project: projectBySlug(
        tenantSlug: "${tenantSlug}"
        projectSlug: "${projectSlug}"
      ) {
        id
      }
    }`)

    if (!project) {
      throw new Error(`couldn't find project "${this.config.projectSlug}"`)
    }

    const { openSession } = await this.client.request(`mutation {
      openSession(input: {
        projectId: "${project.id}"
        clientId: "${this.config.sessionKey}"
      }) {
        testSession {
          id
        }
      }
    }`)

    this.testSessionId = openSession.testSession.id
  }

  async close() {
    if (!this.testSessionId) return

    try {
      await Promise.all(this.capturePromises)
    } finally {
      await this.client.request(`mutation {
        closeSession(input: {
          id: "${this.testSessionId}"
        }) {
          __typename
        }
      }`)
    }
  }

  createCheck(imageData: Buffer, name: string, tags?: Tags) {
    validateArgs({
      imageData: [t.object, imageData],
      name: [t.string, name],
      tags: [t.union([TagsType, t.undefined]), tags],
    })

    t.string.decode(name)
    if (!this.testSessionId) throw new Error('`.open` must be called first')

    tags = { ...this.config.tags, ...tags }

    this.capturePromises.push(
      this.client.request(`mutation {
        createImageCheck(input: {
          testSessionId: "${this.testSessionId}"
          data: "${imageData.toString('base64')}"
          name: "${name}"
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
  private browser: WebDriver
  private seleniumTags: Tags

  constructor({ browser, ...config }: SessionManagerConfig & { browser: any }) {
    super(config)
    validateArgs({
      browser: [t.object, browser],
    })
    this.browser = browser
  }

  async getSeleniumTags(): Promise<Tags> {
    if (this.seleniumTags) return this.seleniumTags

    const capabilities = await this.browser.getCapabilities()
    this.seleniumTags = {
      browser: capabilities.get('browserName'),
      platform: capabilities.get('platform'),
    }

    return this.seleniumTags
  }

  async capture(name: string, tags?: Tags) {
    validateArgs({
      name: [t.string, name],
      tags: [t.union([TagsType, t.undefined]), tags],
    })

    const imageData = await this.browser.takeScreenshot()
    tags = {
      ...(await this.getSeleniumTags()),
      ...tags,
    }
    this.createCheck(new Buffer(imageData, 'base64'), name, tags)
  }
}
