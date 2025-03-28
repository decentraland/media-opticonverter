import { test } from "../components"
import * as path from 'path'
import * as fs from 'fs'
import * as http from 'http'

test("media converter integration tests", function ({ components }) {
  let testServer: http.Server
  let testServerUrl: string

  beforeAll(async () => {
    // Set USE_LOCAL_STORAGE to true for tests
    process.env.USE_LOCAL_STORAGE = 'true'

    // Create a temporary HTTP server to serve the test file
    testServer = http.createServer((req, res) => {
      if (req.url === '/test.svg') {
        const testFile = path.join(process.cwd(), 'test', 'assets', 'test.svg')
        const content = fs.readFileSync(testFile)
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
        res.end(content)
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    // Start server on a random port
    await new Promise<void>((resolve) => {
      testServer.listen(0, () => {
        const address = testServer.address()
        if (address && typeof address !== 'string') {
          testServerUrl = `http://localhost:${address.port}/test.svg`
        }
        resolve()
      })
    })
  })

  afterAll(async () => {
    // Clean up storage directory after tests
    const storagePath = path.join(process.cwd(), 'storage')
    if (fs.existsSync(storagePath)) {
      const files = fs.readdirSync(storagePath)
      for (const file of files) {
        fs.unlinkSync(path.join(storagePath, file))
      }
    }

    // Stop the test server
    await new Promise<void>((resolve) => {
      testServer.close(() => resolve())
    })
  })

  it("should convert SVG to PNG", async () => {
    const { localFetch } = components

    const response = await localFetch.fetch('/convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fileUrl: testServerUrl })
    })

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.url).toMatch(/^http:\/\/localhost:8000\/storage\/[a-f0-9]+\.png$/)

    // Verify the file was created in storage
    const storageKey = result.url.split('/').pop()
    const storagePath = path.join(process.cwd(), 'storage', storageKey)
    expect(fs.existsSync(storagePath)).toBe(true)
  })
}) 