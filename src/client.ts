import * as fetch from 'node-fetch'

const API_URL = 'https://pixelci.io/graphql'

export default class Client {
  constructor(private apiKey: string) {}

  async request(query: string, variables?: object) {
    const resp = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`PixelCI API Error: \n${text}`)
    }

    const { data, errors } = await resp.json()
    if (errors) {
      throw new Error(`PixelCI API Error: \n${JSON.stringify(errors)}`)
    }

    return data
  }
}
