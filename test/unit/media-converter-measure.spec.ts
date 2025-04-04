import { MediaConverter } from '../../src/adapters/media-converter'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { AppComponents } from '../../src/types'
import { metricDeclarations } from '../../src/metrics'
import * as path from 'path'
import * as fs from 'fs'
import * as http from 'http'

// Increase global timeout to 180 seconds
jest.setTimeout(60000 * 3)

describe('MediaConverter Unit Tests', () => {
  let components: AppComponents
  let converter: MediaConverter
  let testServer: http.Server
  let testServerUrl: string

  beforeAll(async () => {
    const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
    const metrics = await createMetricsComponent(metricDeclarations, { config })
    const logs = await createLogComponent({ metrics })
    const fetch = createFetchComponent()

    components = {
      config,
      logs,
      server: null,
      statusChecks: null,
      fetch,
      metrics
    }

    // Set USE_LOCAL_STORAGE to true for tests
    process.env.USE_LOCAL_STORAGE = 'true'

    // Initialize converter with test values
    converter = new MediaConverter('test-bucket', 'test-domain', 'us-east-1', components, true)

    // Create a temporary HTTP server to serve the test files
    testServer = http.createServer((req, res) => {
      //path.join(process.cwd(), 'test', 'assets', 'test.svg')
      const fileName = req.url?.slice(1)
      const filePath = path.join(process.cwd(), 'test', 'assets', `${fileName}`)
      if (filePath && fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath)
        const ext = path.extname(filePath).toLowerCase()
        let contentType = ''
        if (ext === '.png') {
          contentType = 'image/png'
        } else if (ext === '.jpg' || ext === '.jpeg') {
          contentType = 'image/jpeg'
        }
        res.writeHead(200, { 'Content-Type': contentType })
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
          testServerUrl = `http://localhost:${address.port}`
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

  const groups = ['img0', 'img1', 'img2', 'img3']
  const resolutions = ['5k', '2.5k', '1.5k', '1k', '0.5k']
  const formats = [
    { ext: 'png', label: 'PNG' },
    { ext: 'jpg', label: 'JPG' }
  ]

  resolutions.forEach((res) => {
    groups.forEach((group) => {
      describe(`Group ${group}`, () => {
        formats.forEach(({ ext, label }) => {
          describe(`${res} ${label}`, () => {
            it(`${label} -> KTX2`, async () => {
              const url = `${testServerUrl}/measure/${group}/${res}.${ext}`

              const startTime = process.hrtime()
              await converter.convert(url, true, true)
              const diff = process.hrtime(startTime)
              const durationMs = Math.floor(diff[0] * 1000 + diff[1] / 1e6)

              const startTimeNoPng = process.hrtime()
              await converter.convert(url, true, false)
              const diffNoPng = process.hrtime(startTimeNoPng)
              const durationMsNoPng = Math.floor(diffNoPng[0] * 1000 + diffNoPng[1] / 1e6)

              const durationDiff = Math.abs(durationMs - durationMsNoPng)
              const comparison = durationMsNoPng < durationMs ? 'FASTER' : 'SLOWER'
              console.log(
                `Conversion for ${group} ${res} ${label} was ${durationDiff}ms ${comparison} for NOPNG | TotalPNG: ${durationMs}ms TotalNOPNG: ${durationMsNoPng}ms`
              )
            })
          })
        })
      })
    })
  })
})
