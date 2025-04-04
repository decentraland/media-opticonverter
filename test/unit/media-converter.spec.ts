import { MediaConverter } from '../../src/adapters/media-converter'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createMetricsComponent } from '@well-known-components/metrics'
import { AppComponents } from '../../src/types'
import { metricDeclarations } from '../../src/metrics'
import { convertHandler } from '../../src/controllers/handlers/convert-handler'
import * as path from 'path'
import * as fs from 'fs'
import * as http from 'http'
import * as crypto from 'crypto'
import sharp from 'sharp'
import * as ffmpeg from 'fluent-ffmpeg'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as os from 'os'
import { createLogsMockComponent } from '../mocks/logs-mock'

const execAsync = promisify(exec)

// Increase global timeout to 180 seconds
jest.setTimeout(60000 * 3)

describe('MediaConverter Unit Tests', () => {
  let components: AppComponents
  let converter: MediaConverter
  let testServer: http.Server
  let testServerUrl: string
  let testFiles: { [key: string]: string }
  let expectedHashes: { [key: string]: string }
  let originalFileSizes: { [key: string]: number }

  // Helper function to generate the same hash as MediaConverter
  const generateShortHash = (str: string): string => {
    return crypto.createHash('md5').update(str).digest('hex').substring(0, 8)
  }

  // Helper function to get image dimensions
  const getImageDimensions = async (filePath: string): Promise<{ width: number; height: number }> => {
    const metadata = await sharp(filePath).metadata()
    return { width: metadata.width || 0, height: metadata.height || 0 }
  }

  // Helper function to get video dimensions
  const getVideoDimensions = (filePath: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) reject(err)
        const videoStream = metadata.streams.find((s) => s.codec_type === 'video')
        resolve({
          width: videoStream?.width || 0,
          height: videoStream?.height || 0
        })
      })
    })
  }

  // Helper function to get KTX2 dimensions
  async function getKTX2Dimensions(filePath: string): Promise<{ width: number; height: number }> {
    const { stdout } = await execAsync(`ktxinfo "${filePath}"`)
    const widthMatch = stdout.match(/pixelWidth:\s+(\d+)/)
    const heightMatch = stdout.match(/pixelHeight:\s+(\d+)/)

    if (!widthMatch || !heightMatch) {
      throw new Error('Could not extract dimensions from KTX2 file')
    }

    return {
      width: parseInt(widthMatch[1], 10),
      height: parseInt(heightMatch[1], 10)
    }
  }

  // Helper function to get dimensions based on file type
  const getDimensions = async (filePath: string): Promise<{ width: number; height: number }> => {
    if (filePath.endsWith('.ktx2')) {
      return getKTX2Dimensions(filePath)
    } else if (filePath.endsWith('.mp4')) {
      return getVideoDimensions(filePath)
    } else {
      return getImageDimensions(filePath)
    }
  }

  beforeAll(async () => {
    const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
    const metrics = await createMetricsComponent(metricDeclarations, { config })
    const logs = createLogsMockComponent()

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

    // Initialize converter with test values using getInstance
    converter = MediaConverter.getInstance('test-bucket', 'test-domain', 'us-east-1', components, true)

    // Set up test files
    testFiles = {
      svg: path.join(process.cwd(), 'test', 'assets', 'test.svg'),
      png: path.join(process.cwd(), 'test', 'assets', 'test.png'),
      webp: path.join(process.cwd(), 'test', 'assets', 'test.webp'),
      animated_webp: path.join(process.cwd(), 'test', 'assets', 'test_animated.webp'),
      jpg: path.join(process.cwd(), 'test', 'assets', 'test.jpg'),
      jpeg: path.join(process.cwd(), 'test', 'assets', 'test.jpeg'),
      gif: path.join(process.cwd(), 'test', 'assets', 'test.gif'),
      empty: path.join(process.cwd(), 'test', 'assets', 'empty.png'),
      invalid: path.join(process.cwd(), 'test', 'assets', 'invalid.txt'),
      invalid_svg: path.join(process.cwd(), 'test', 'assets', 'invalid.svg'),
      temp: path.join(os.tmpdir(), `test_${Date.now()}`),
      noext: path.join(os.tmpdir(), `test_${Date.now()}`)
    }

    // Get original file sizes
    originalFileSizes = {
      svg: fs.statSync(testFiles.svg).size,
      png: fs.statSync(testFiles.png).size,
      webp: fs.statSync(testFiles.webp).size,
      animated_webp: fs.statSync(testFiles.animated_webp).size,
      jpg: fs.statSync(testFiles.jpg).size,
      jpeg: fs.statSync(testFiles.jpeg).size,
      gif: fs.statSync(testFiles.gif).size
    }

    // Create a temporary HTTP server to serve the test files
    testServer = http.createServer((req, res) => {
      const filePath = testFiles[req.url?.slice(1).split('.')[0] || '']
      if (filePath && fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath)
        const contentType = {
          svg: 'image/svg+xml',
          png: 'image/png',
          webp: 'image/webp',
          animated_webp: 'image/webp',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          empty: 'image/png',
          invalid: 'text/plain',
          invalid_svg: 'image/svg+xml',
          temp: 'image/png',
          noext: 'image/png'
        }[req.url?.slice(1).split('.')[0] || '']
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

    // Calculate expected hashes
    expectedHashes = {
      svg: generateShortHash(`${testServerUrl}/svg`),
      png: generateShortHash(`${testServerUrl}/png`),
      webp: generateShortHash(`${testServerUrl}/webp`),
      animated_webp: generateShortHash(`${testServerUrl}/animated_webp`),
      jpg: generateShortHash(`${testServerUrl}/jpg`),
      jpeg: generateShortHash(`${testServerUrl}/jpeg`),
      gif: generateShortHash(`${testServerUrl}/gif`)
    }
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

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('SVG files', () => {
    it('should convert static SVG to PNG', async () => {
      const result = await converter.convert(`${testServerUrl}/svg`)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.svg}.png`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.svg}.png`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify file size is smaller than original
      const resultSize = fs.statSync(storagePath).size
      expect(resultSize).toBeLessThan(originalFileSizes.svg)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })

    it('should convert SVG to KTX2 when ktx2Enabled is true', async () => {
      const result = await converter.convert(`${testServerUrl}/svg`, true)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.svg}.ktx2`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.svg}.ktx2`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })
  })

  describe('PNG files', () => {
    it('should keep PNG as PNG', async () => {
      const result = await converter.convert(`${testServerUrl}/png`)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.png}.png`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.png}.png`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify file size is smaller than original
      const resultSize = fs.statSync(storagePath).size
      expect(resultSize).toBeLessThan(originalFileSizes.png)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })

    it('should convert PNG to KTX2 when ktx2Enabled is true', async () => {
      const result = await converter.convert(`${testServerUrl}/png`, true)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.png}.ktx2`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.png}.ktx2`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify file size is smaller than original
      const resultSize = fs.statSync(storagePath).size
      expect(resultSize).toBeLessThan(originalFileSizes.png)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })

    it('should convert PNG to KTX2 with preProcessToPNG', async () => {
      const result = await converter.convert(`${testServerUrl}/png`, true, true)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.png}.ktx2`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.png}.ktx2`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify file size is smaller than original
      const resultSize = fs.statSync(storagePath).size
      expect(resultSize).toBeLessThan(originalFileSizes.png)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })
  })

  describe('JPG files', () => {
    it('should convert JPG to JPG', async () => {
      const result = await converter.convert(`${testServerUrl}/jpg`)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.jpg}.jpg`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.jpg}.jpg`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify file size is smaller than original
      const resultSize = fs.statSync(storagePath).size
      expect(resultSize).toBeLessThan(originalFileSizes.jpg)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })

    it('should convert JPG to KTX2 when ktx2Enabled is true', async () => {
      const result = await converter.convert(`${testServerUrl}/jpg`, true)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.jpg}.ktx2`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.jpg}.ktx2`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })

    it('should convert JPG to KTX2 with preProcessToPNG', async () => {
      const result = await converter.convert(`${testServerUrl}/jpg`, true, true)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.jpg}.ktx2`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.jpg}.ktx2`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })
  })

  describe('JPEG files', () => {
    it('should convert JPEG to JPEG', async () => {
      const result = await converter.convert(`${testServerUrl}/jpeg`)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.jpeg}.jpg`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.jpeg}.jpg`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify file size is smaller than original
      const resultSize = fs.statSync(storagePath).size
      expect(resultSize).toBeLessThan(originalFileSizes.jpeg)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })

    it('should convert JPEG to KTX2 when ktx2Enabled is true', async () => {
      const result = await converter.convert(`${testServerUrl}/jpeg`, true)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.jpeg}.ktx2`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.jpeg}.ktx2`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })

    it('should convert JPEG to KTX2 with preProcessToPNG', async () => {
      const result = await converter.convert(`${testServerUrl}/jpeg`, true, true)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.jpeg}.ktx2`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.jpeg}.ktx2`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })
  })

  describe('WebP files', () => {
    it('should convert static WebP to PNG', async () => {
      const result = await converter.convert(`${testServerUrl}/webp`)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.webp}.png`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.webp}.png`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Not Verify file size is cause webp is super low quality
      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })

    it('should convert static WebP to KTX2 when ktx2Enabled is true', async () => {
      const result = await converter.convert(`${testServerUrl}/webp`, true)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.webp}.ktx2`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.webp}.ktx2`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Not Verify file size is cause webp is super low quality
      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(1024)
      expect(dimensions.height).toBeLessThanOrEqual(1024)
    })

    it('should convert animated WEBP to MP4', async () => {
      const result = await converter.convert(`${testServerUrl}/animated_webp`)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.animated_webp}.mp4`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.animated_webp}.mp4`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify file size is smaller than original
      const resultSize = fs.statSync(storagePath).size
      expect(resultSize).toBeLessThan(originalFileSizes.animated_webp)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(512)
      expect(dimensions.height).toBeLessThanOrEqual(512)
    })
  })

  describe('GIF files', () => {
    it('should convert GIF to MP4', async () => {
      const result = await converter.convert(`${testServerUrl}/gif`)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.gif}.mp4`
      expect(result).toBe(expectedUrl)

      // Verify the file was created in storage with the expected name
      const storagePath = path.join(process.cwd(), 'storage', `${expectedHashes.gif}.mp4`)
      expect(fs.existsSync(storagePath)).toBe(true)

      // Verify file size is smaller than original
      const resultSize = fs.statSync(storagePath).size
      expect(resultSize).toBeLessThan(originalFileSizes.gif)

      // Verify dimensions are within limits
      const dimensions = await getDimensions(storagePath)
      expect(dimensions.width).toBeLessThanOrEqual(512)
      expect(dimensions.height).toBeLessThanOrEqual(512)
    })
  })

  describe('Error handling', () => {
    it('should handle invalid file URLs', async () => {
      await expect(converter.convert('invalid-url')).rejects.toThrow('File not found or cannot be downloaded')
    })

    it('should handle empty files', async () => {
      const emptyFile = path.join(process.cwd(), 'test', 'assets', 'empty.png')
      fs.writeFileSync(emptyFile, '')

      // Add empty file to test server
      testFiles['empty'] = emptyFile

      await expect(converter.convert(`${testServerUrl}/empty`)).rejects.toThrow('File cannot be downloaded or is empty')

      fs.unlinkSync(emptyFile)
      delete testFiles['empty']
    })

    it('should handle unsupported file types', async () => {
      const invalidFile = path.join(process.cwd(), 'test', 'assets', 'invalid.txt')
      fs.writeFileSync(invalidFile, 'invalid content')

      // Add invalid file to test server
      testFiles['invalid'] = invalidFile

      await expect(converter.convert(`${testServerUrl}/invalid`)).rejects.toThrow('Could not detect file type')

      fs.unlinkSync(invalidFile)
      delete testFiles['invalid']
    })

    it('should handle conversion failures', async () => {
      const invalidSvg = path.join(process.cwd(), 'test', 'assets', 'invalid.svg')
      fs.writeFileSync(invalidSvg, '<invalid>svg</invalid>')

      // Add invalid SVG to test server
      testFiles['invalid_svg'] = invalidSvg

      await expect(converter.convert(`${testServerUrl}/invalid_svg`)).rejects.toThrow()

      fs.unlinkSync(invalidSvg)
      delete testFiles['invalid_svg']
    })
  })

  describe('File type detection', () => {
    it('should detect file type from buffer', async () => {
      const pngFile = path.join(process.cwd(), 'test', 'assets', 'test.png')
      const buffer = fs.readFileSync(pngFile)
      const tempFile = path.join(os.tmpdir(), `test_${Date.now()}`)
      fs.writeFileSync(tempFile, buffer)

      // Add temp file to test server
      testFiles['temp'] = tempFile

      const result = await converter.convert(`${testServerUrl}/temp`)
      expect(result).toContain('.png')

      fs.unlinkSync(tempFile)
      delete testFiles['temp']
    })

    it('should handle files without extension', async () => {
      const pngFile = path.join(process.cwd(), 'test', 'assets', 'test.png')
      const tempFile = path.join(os.tmpdir(), `test_${Date.now()}`)
      fs.copyFileSync(pngFile, tempFile)

      // Add temp file to test server
      testFiles['noext'] = tempFile

      const result = await converter.convert(`${testServerUrl}/noext`)
      expect(result).toContain('.png')

      fs.unlinkSync(tempFile)
      delete testFiles['noext']
    })
  })

  describe('Local storage mode', () => {
    it('should work with local storage', async () => {
      const result = await converter.convert(`${testServerUrl}/png`)
      expect(result).toContain('localhost')
      expect(result).toContain('/storage/')

      // Clean up
      const storagePath = path.join(process.cwd(), 'storage')
      if (fs.existsSync(storagePath)) {
        const files = fs.readdirSync(storagePath)
        for (const file of files) {
          fs.unlinkSync(path.join(storagePath, file))
        }
      }
    })
  })

  describe('GET /convert', () => {
    it('should return 302 with Location header for successful conversion', async () => {
      const mockContext = {
        components,
        request: new Request(`http://localhost:8000/convert?fileUrl=${encodeURIComponent(testServerUrl + '/png')}`)
      }
      const response = await convertHandler(mockContext as any)
      expect(response.status).toBe(302)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.png}.png`
      expect(response.headers['Location']).toBe(expectedUrl)
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*')
      expect(response.headers['Cache-Control']).toBe('public, max-age=31536000')
    })

    it('should return 429 with Retry-After header when file is already being processed', async () => {
      // Mock the converter to throw the specific error
      const mockConverter = {
        convert: jest
          .fn()
          .mockRejectedValue(new Error('Processing hash already exists, try again in a few seconds abc123'))
      }
      const mockContext = {
        components: {
          ...components,
          config: {
            ...components.config,
            getString: jest.fn().mockResolvedValue('true'),
            requireString: jest.fn()
          }
        },
        request: new Request(`http://localhost:8000/convert?fileUrl=${encodeURIComponent(testServerUrl + '/png')}`)
      }

      // Replace the converter with our mock
      jest.spyOn(MediaConverter.prototype, 'convert').mockImplementation(mockConverter.convert)

      const response = await convertHandler(mockContext as any)
      expect(response.status).toBe(429)
      expect(response.headers['Retry-After']).toBe('30')
      expect(response.headers['Cache-Control']).toBe('no-cache')
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*')
      expect(response.body).toEqual({
        error: 'Processing hash already exists, try again in a few seconds abc123',
        retryAfter: 5
      })
    })

    it('should return 400 when fileUrl is missing', async () => {
      const mockContext = {
        components,
        request: new Request('http://localhost:8000/convert')
      }
      const response = await convertHandler(mockContext as any)
      expect(response.status).toBe(400)
      expect(response.body?.error).toBe('fileUrl is required')
    })

    it('should handle CORS headers correctly', async () => {
      const mockContext = {
        components,
        request: new Request(`http://localhost:8000/convert?fileUrl=${encodeURIComponent(testServerUrl + '/png')}`)
      }
      const response = await convertHandler(mockContext as any)
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*')
      expect(response.headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS')
      expect(response.headers['Access-Control-Allow-Headers']).toBe('Content-Type')
    })

    it('should handle preProcessToPNG parameter in GET request', async () => {
      const mockContext = {
        components,
        request: new Request(
          `http://localhost:8000/convert?fileUrl=${encodeURIComponent(
            testServerUrl + '/png'
          )}&ktx2=true&preProcessToPNG=true`
        )
      }
      const response = await convertHandler(mockContext as any)
      expect(response.status).toBe(302)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.png}.ktx2`
      expect(response.headers['Location']).toBe(expectedUrl)
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*')
      expect(response.headers['Cache-Control']).toBe('public, max-age=31536000')
    })
  })

  describe('POST /convert', () => {
    it('should handle preProcessToPNG parameter in POST request', async () => {
      const mockContext = {
        components,
        request: new Request('http://localhost:8000/convert', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fileUrl: `${testServerUrl}/png`,
            ktx2: true,
            preProcessToPNG: true
          })
        })
      }
      const response = await convertHandler(mockContext as any)
      expect(response.status).toBe(200)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.png}.ktx2`
      expect(response.body.url).toBe(expectedUrl)
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*')
      expect(response.headers['Cache-Control']).toBe('public, max-age=31536000')
    })

    it('should handle preProcessToPNG parameter as false by default in POST request', async () => {
      const mockContext = {
        components,
        request: new Request('http://localhost:8000/convert', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fileUrl: `${testServerUrl}/png`,
            ktx2: true
          })
        })
      }
      const response = await convertHandler(mockContext as any)
      expect(response.status).toBe(200)
      const expectedUrl = `http://localhost:8000/storage/${expectedHashes.png}.ktx2`
      expect(response.body.url).toBe(expectedUrl)
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*')
      expect(response.headers['Cache-Control']).toBe('public, max-age=31536000')
    })
  })
})
