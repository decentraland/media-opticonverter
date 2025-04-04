import { MediaConverter } from '../../src/adapters/media-converter'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createLogComponent } from '@well-known-components/logger'
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

const execAsync = promisify(exec)

// Increase global timeout to 60 seconds
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

        // Set up test files
        // testFiles = {
        //     svg: path.join(process.cwd(), 'test', 'assets', 'test.svg'),
        //     png: path.join(process.cwd(), 'test', 'assets', 'test.png'),
        //     webp: path.join(process.cwd(), 'test', 'assets', 'test.webp'),
        //     animated_webp: path.join(process.cwd(), 'test', 'assets', 'test_animated.webp'),
        //     jpg: path.join(process.cwd(), 'test', 'assets', 'test.jpg'),
        //     jpeg: path.join(process.cwd(), 'test', 'assets', 'test.jpeg'),
        //     gif: path.join(process.cwd(), 'test', 'assets', 'test.gif'),
        //     empty: path.join(process.cwd(), 'test', 'assets', 'empty.png'),
        //     invalid: path.join(process.cwd(), 'test', 'assets', 'invalid.txt'),
        //     invalid_svg: path.join(process.cwd(), 'test', 'assets', 'invalid.svg'),
        //     temp: path.join(os.tmpdir(), `test_${Date.now()}`),
        //     noext: path.join(os.tmpdir(), `test_${Date.now()}`),


        // }

        // // Get original file sizes
        // originalFileSizes = {
        //     svg: fs.statSync(testFiles.svg).size,
        //     png: fs.statSync(testFiles.png).size,
        //     webp: fs.statSync(testFiles.webp).size,
        //     animated_webp: fs.statSync(testFiles.animated_webp).size,
        //     jpg: fs.statSync(testFiles.jpg).size,
        //     jpeg: fs.statSync(testFiles.jpeg).size,
        //     gif: fs.statSync(testFiles.gif).size
        // }

        // Create a temporary HTTP server to serve the test files
        testServer = http.createServer((req, res) => {
            //path.join(process.cwd(), 'test', 'assets', 'test.svg')
            const fileName = req.url?.slice(1);
            const filePath = path.join(process.cwd(), 'test', 'assets', `${fileName}`);
            if (filePath && fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath)
                const ext = path.extname(filePath).toLowerCase();
                let contentType = '';
                if (ext === '.png') {
                  contentType = 'image/png';
                } else if (ext === '.jpg' || ext === '.jpeg') {
                  contentType = 'image/jpeg';
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

                            const startTime = process.hrtime();
                            await converter.convert(url, true, true)
                            const diff = process.hrtime(startTime);
                            const durationMs = Math.floor(diff[0] * 1000 + diff[1] / 1e6);

                            const startTimeNoPng = process.hrtime();
                            await converter.convert(url, true, false)
                            const diffNoPng = process.hrtime(startTimeNoPng);
                            const durationMsNoPng = Math.floor(diffNoPng[0] * 1000 + diffNoPng[1] / 1e6);

                            const durationDiff = Math.abs(durationMs - durationMsNoPng);
                            const comparison = durationMsNoPng < durationMs ? 'FASTER' : 'SLOWER';
                            console.log(`Conversion for ${group} ${res} ${label} was ${durationDiff}ms ${comparison} for NOPNG | TotalPNG: ${durationMs}ms TotalNOPNG: ${durationMsNoPng}ms`);
                        })
                    })
                })
            })
        })
    })
})