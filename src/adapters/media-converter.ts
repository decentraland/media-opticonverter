import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import sharp from 'sharp'
import { AppComponents } from '../types'

const execAsync = promisify(exec)

export class MediaConverter {
  private s3Client: S3Client | null
  private bucket: string
  private cloudfrontDomain: string
  private components: AppComponents
  private logger
  private useLocalStorage: boolean
  private localStoragePath: string

  constructor(
    bucket: string,
    cloudfrontDomain: string,
    region: string,
    components: AppComponents,
    useLocalStorage: boolean = false
  ) {
    this.bucket = bucket
    this.cloudfrontDomain = cloudfrontDomain
    this.s3Client = useLocalStorage
      ? null
      : new S3Client({
          region,
          maxAttempts: 3,
          requestHandler: {
            connectionTimeout: 5000, // 5 seconds
            socketTimeout: 60000, // 30 seconds
            keepAlive: true,
            keepAliveMsecs: 1000
          }
        })
    this.components = components
    this.logger = components.logs.getLogger('media-converter')
    this.useLocalStorage = useLocalStorage
    this.localStoragePath = path.join(process.cwd(), 'storage')

    if (useLocalStorage && !fs.existsSync(this.localStoragePath)) {
      fs.mkdirSync(this.localStoragePath, { recursive: true })
    }
  }

  private generateShortHash(str: string): string {
    return crypto.createHash('md5').update(str).digest('hex').substring(0, 8)
  }

  private async fileExists(key: string): Promise<string | null> {
    this.logger.info('Checking if file exists', { key })
    if (this.useLocalStorage) {
      const filePath = path.join(this.localStoragePath, key)
      return fs.existsSync(filePath) ? key : null
    } else {
      try {
        const listCommand = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: key,
          MaxKeys: 1
        })

        const listResult = await this.s3Client!.send(listCommand)
        if (listResult.Contents && listResult.Contents.length > 0) {
          return listResult.Contents[0].Key || null
        }
        return null
      } catch (error) {
        this.logger.info('Error checking file existence in S3:', {
          error: error instanceof Error ? error.message : String(error)
        })
        return null
      }
    }
  }

  private async uploadFile(key: string, filePath: string, contentType: string): Promise<boolean> {
    this.logger.info('Uploading File', { filePath, contentType })

    if (this.useLocalStorage) {
      const targetPath = path.join(this.localStoragePath, key)
      if (fs.existsSync(targetPath)) {
        return true
      }
      fs.copyFileSync(filePath, targetPath)
      return false
    } else {
      try {
        // First check if file exists
        const listCommand = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: key,
          MaxKeys: 1
        })

        const listResult = await this.s3Client!.send(listCommand)
        if (listResult.Contents && listResult.Contents.length > 0) {
          return true
        }

        // If not exists, upload it
        await this.s3Client!.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: fs.createReadStream(filePath),
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000'
          })
        )
        return false
      } catch (error) {
        this.logger.error('Error in uploadFile:', { error: error instanceof Error ? error.message : String(error) })
        throw error
      }
    }
  }

  private getFileUrl(key: string): string {
    if (this.useLocalStorage) {
      return `http://localhost:${process.env.PORT || '8000'}/storage/${key}`
    }
    return `https://${this.cloudfrontDomain}/${key}`
  }

  private async detectFileType(filePath: string): Promise<string> {
    this.logger.info('Detecting file ext', { filePath })
    try {
      const buffer = fs.readFileSync(filePath, { encoding: null })
      const header = buffer.slice(0, 12)

      if (
        header[0] === 0x52 && // R
        header[1] === 0x49 && // I
        header[2] === 0x46 && // F
        header[3] === 0x46 && // F
        header[8] === 0x57 && // W
        header[9] === 0x45 && // E
        header[10] === 0x42 && // B
        header[11] === 0x50
      ) {
        // P
        return '.webp'
      }

      try {
        const metadata = await sharp(filePath).metadata()
        switch (metadata.format) {
          case 'png':
            return '.png'
          case 'jpeg':
            return '.jpg'
          case 'webp':
            return '.webp'
          case 'gif':
            return '.gif'
          case 'svg':
            return '.svg'
        }
      } catch (error) {
        this.logger.info('Sharp metadata failed:', { error: error instanceof Error ? error.message : String(error) })
      }

      try {
        const { stdout } = await execAsync(`file -b --mime-type "${filePath}"`)
        const mimeType = stdout.trim()

        switch (mimeType) {
          case 'image/png':
            return '.png'
          case 'image/jpeg':
            return '.jpg'
          case 'image/webp':
            return '.webp'
          case 'image/gif':
            return '.gif'
          case 'image/svg+xml':
            return '.svg'
          default:
            if (mimeType.startsWith('image/')) {
              const ext = mimeType.split('/')[1]
              return `.${ext}`
            }
        }
      } catch (fileError) {
        this.logger.info('file command failed:', {
          error: fileError instanceof Error ? fileError.message : String(fileError)
        })
      }

      throw new Error('Could not detect file type')
    } catch (error) {
      this.logger.error('Error in detectFileType:', { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  private async isAnimatedWebP(filePath: string): Promise<boolean> {
    try {
      const buffer = fs.readFileSync(filePath, { encoding: null })
      if (
        buffer[0] === 0x52 && // R
        buffer[1] === 0x49 && // I
        buffer[2] === 0x46 && // F
        buffer[3] === 0x46 && // F
        buffer[8] === 0x57 && // W
        buffer[9] === 0x45 && // E
        buffer[10] === 0x42 && // B
        buffer[11] === 0x50
      ) {
        // P

        const content = buffer.toString('ascii')
        const hasANIM = content.includes('ANIM')
        const hasANMF = content.includes('ANMF')

        if (hasANIM || hasANMF) {
          try {
            const metadata = await sharp(filePath).metadata()
            return metadata.pages ? metadata.pages > 1 : false
          } catch (error) {
            this.logger.info('Sharp metadata failed:', {
              error: error instanceof Error ? error.message : String(error)
            })
            return true
          }
        }
      }
      return false
    } catch (error) {
      this.logger.info('Error checking if WebP is animated:', {
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  private async getConversionConfig(
    ext: string,
    inputPath: string,
    ktx2Enabled: boolean
  ): Promise<{
    outExt: string
    mimetype: string
    convertCommand: string[]
    optimizeCommand?: string[]
    ktx2Command?: string[]
  }> {
    const normalizedExt = ext.toLowerCase()

    switch (normalizedExt) {
      case '.svg': {
        return {
          outExt: ktx2Enabled ? '.ktx2' : '.png',
          mimetype: ktx2Enabled ? 'image/ktx2' : 'image/png',
          convertCommand: ['sharp', '${input}', '${output}']
        }
      }

      case '.gif': {
        return {
          outExt: '.mp4',
          mimetype: 'video/mp4',
          convertCommand: [
            'ffmpeg',
            '-y',
            '-i',
            '${input}',
            '-movflags',
            '+faststart',
            '-pix_fmt',
            'yuv420p',
            '-vf',
            'scale=512:-1:flags=lanczos',
            '-c:v',
            'libx264',
            '-crf',
            '28',
            '-preset',
            'veryfast',
            '${output}'
          ]
        }
      }

      case '.webp': {
        if (await this.isAnimatedWebP(inputPath)) {
          try {
            const metadata = await sharp(inputPath).metadata()
            const frames = metadata.pages || 1
            if (frames > 1) {
              // Create frames directory
              const framesDir = path.join(os.tmpdir(), `frames_${Date.now()}`)
              fs.mkdirSync(framesDir)

              // Extract frames
              const targetFrames = Math.ceil(frames * 0.7) // 70% of total frames
              const step = frames / targetFrames // Step to evenly sample frames
              // Process frames in parallel with a concurrency limit of 10
              const framePromises = []
              const concurrencyLimit = 100

              for (let i = 0; i < targetFrames; i++) {
                const frameIndex = Math.floor(i * step) // Get the frame index
                const framePath = path.join(framesDir, `frame_${i}.png`)
                framePromises.push(
                  sharp(inputPath, { page: frameIndex })
                    .resize(512, 512, {
                      fit: 'inside',
                      withoutEnlargement: true
                    })
                    .toFile(framePath)
                )

                // Process in batches of 10 to avoid memory issues
                if (framePromises.length === concurrencyLimit) {
                  await Promise.all(framePromises)
                  framePromises.length = 0
                }
              }

              // Process remaining frames
              if (framePromises.length > 0) {
                await Promise.all(framePromises)
              }

              return {
                outExt: '.mp4',
                mimetype: 'video/mp4',
                convertCommand: [
                  'ffmpeg',
                  '-y',
                  '-framerate',
                  '10',
                  '-i',
                  path.join(framesDir, 'frame_%d.png'),
                  '-movflags',
                  '+faststart',
                  '-pix_fmt',
                  'yuv420p',
                  '-vf',
                  'scale=512:-1:flags=lanczos',
                  '-c:v',
                  'libx264',
                  '-crf',
                  '28',
                  '-preset',
                  'veryfast',
                  '${output}'
                ]
              }
            }
          } catch (error) {
            this.logger.info('Error checking WebP frames:', {
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }

        return {
          outExt: ktx2Enabled ? '.ktx2' : '.png',
          mimetype: ktx2Enabled ? 'image/ktx2' : 'image/png',
          convertCommand: ['sharp', '${input}', '${output}']
        }
      }

      case '.jpg':
      case '.jpeg':
        return {
          outExt: ktx2Enabled ? '.ktx2' : '.jpg',
          mimetype: ktx2Enabled ? 'image/ktx2' : 'image/jpeg',
          convertCommand: ['sharp', '${input}', '${output}']
        }
      case '.png': {
        return {
          outExt: ktx2Enabled ? '.ktx2' : '.png',
          mimetype: ktx2Enabled ? 'image/ktx2' : 'image/png',
          convertCommand: ['sharp', '${input}', '${output}']
        }
      }

      default:
        throw new Error(`Unsupported file type: ${normalizedExt}`)
    }
  }

  public async convert(
    fileUrl: string,
    ktx2Enabled: boolean = false,
    preProcessToPNG: boolean = false
  ): Promise<string> {
    let tempInputPath = ''
    let outputPath = ''

    try {
      this.logger.info('Starting convert', {
        fileUrl,
        ktx2Enabled: ktx2Enabled.toString(),
        preProcessToPNG: preProcessToPNG.toString()
      })
      // Clean URL by removing query parameters
      const cleanUrl = fileUrl.split('?')[0]
      let ext = path.extname(cleanUrl)
      const shortHash = this.generateShortHash(cleanUrl)

      // Check if file exists in storage
      let storageKey = await this.fileExists(shortHash)
      if (storageKey) {
        this.logger.info('File found, returning it', { storageKey })
        return this.getFileUrl(storageKey)
      }
      this.logger.info('File not found, processing it', { shortHash })

      // Download input file
      tempInputPath = path.join(os.tmpdir(), `input_${Date.now()}`)
      try {
        this.logger.info('Downloading file', { fileUrl, shortHash })
        const response = await this.components.fetch.fetch(fileUrl)
        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.statusText}`)
        }
        const buffer = await response.arrayBuffer()
        fs.writeFileSync(tempInputPath, Buffer.from(buffer))
      } catch (error) {
        this.logger.error('Download error:', { error: error instanceof Error ? error.message : String(error) })
        throw new Error('File not found or cannot be downloaded')
      }

      // Verify file was downloaded
      if (!fs.existsSync(tempInputPath) || fs.statSync(tempInputPath).size === 0) {
        throw new Error('File cannot be downloaded or is empty')
      }

      // Detect file type if no extension
      if (!ext) {
        ext = await this.detectFileType(tempInputPath)
      }
      this.logger.info('File ext detected', { ext, shortHash })

      const config = await this.getConversionConfig(ext, tempInputPath, ktx2Enabled)

      storageKey = `${shortHash}${config.outExt}`
      outputPath = path.join(os.tmpdir(), `output_${shortHash}${config.outExt}`)

      // Convert file
      if (config.convertCommand[0] === 'sharp') {
        this.logger.info('Processing sharp convert command', { ext, storageKey })

        const sharpInstance = sharp(tempInputPath).resize(1024, 1024, {
          fit: 'inside',
          withoutEnlargement: true
        })

        // Optimize based on input format
        if (ext === '.svg' || ext === '.webp') {
          this.logger.info('Sharp command for ext', { ext })

          // SVG: Use smaller palette and more aggressive compression
          await sharpInstance
            .png({
              compressionLevel: 9,
              quality: 80,
              palette: true,
              colors: 128, // Reduced palette for SVG
              effort: 10
            })
            .toFile(outputPath)
        } else if ((ext === '.jpg' || ext === '.jpeg') && !ktx2Enabled) {
          this.logger.info('Sharp command when ktk2 is not enabled and ext', { ext, storageKey })
          await sharpInstance
            .jpeg({
              mozjpeg: true, // Use mozjpeg optimization
              quality: 80, // Lower quality for JPG/JPEG
              progressive: true, // Progressive loading
              optimizeCoding: true, // Optimize Huffman coding tables
              quantisationTable: 0, // Use default quantization table
              force: false // Force JPEG output even if input is JPEG
            })
            .toFile(outputPath)
        } else if (!ktx2Enabled || preProcessToPNG) {
          this.logger.info('Sharp command when ktk2 is not enabled or pre process to png is enable', {
            ext,
            storageKey
          })
          // Default for other formats
          await sharpInstance
            .png({
              compressionLevel: 9,
              quality: 80,
              palette: true,
              colors: 256,
              effort: 10
            })
            .toFile(outputPath)
        } else {
          this.logger.info('Sharp command to just resize the file to the supported limits', { ext, storageKey })
          await sharpInstance.toFile(outputPath)
        }

        if (ktx2Enabled) {
          // First convert to KTX2 with toktx
          const ktx2TempPath = path.join(os.tmpdir(), `temp_ktx2_${shortHash}.ktx2`)

          const toktxCommand = `toktx --t2 --uastc --genmipmap --zcmp 3 --lower_left_maps_to_s0t0 --assign_oetf srgb "${ktx2TempPath}" "${outputPath}"`

          this.logger.info('Executing toktx command:', { command: toktxCommand })
          const { stdout: toktxStdout, stderr: toktxError } = await execAsync(toktxCommand)
          this.logger.info(`'Executing toktx command stdout: ${toktxStdout}`)
          if (toktxError) this.logger.info('Toktx conversion stderr:', { error: toktxError })

          if (!fs.existsSync(ktx2TempPath)) {
            throw new Error(`File not found: ${ktx2TempPath}`)
          }

          const size = fs.statSync(ktx2TempPath).size
          if (size < 100) {
            throw new Error(`File ${ktx2TempPath} exists but is too small to be a valid .ktx2 (${size} bytes)`)
          }

          // remove this line if then apply optimizations
          outputPath = ktx2TempPath
        }
      } else if (config.convertCommand[0] === 'ffmpeg') {
        this.logger.info('Executing ffmpeg command', { ext, storageKey })

        // ffmpeg c
        const convertCommand = config.convertCommand
          .map((cmd) => cmd.replace('${input}', tempInputPath).replace('${output}', outputPath))
          .join(' ')

        const { stdout: _, stderr: convertError } = await execAsync(convertCommand)
        if (convertError) this.logger.info('Conversion stderr:', { error: convertError })
      } else {
        throw new Error(`Unsupported conversion command: ${config.convertCommand[0]}`)
      }

      // Verify converted file
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error('Conversion failed: output file not created or is empty')
      }
      // Upload to storage and check if file already existed
      const fileAlreadyExists = await this.uploadFile(storageKey, outputPath, config.mimetype)
      if (fileAlreadyExists) {
        this.logger.info('File uploaded successfully', { storageKey })

        return this.getFileUrl(storageKey)
      }

      return this.getFileUrl(storageKey)
    } catch (error) {
      this.logger.error('Error processing request:', { error: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      // Clean up files
      try {
        if (outputPath && fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath)
        }
        if (tempInputPath && fs.existsSync(tempInputPath)) {
          fs.unlinkSync(tempInputPath)
        }
        // Clean up frames directory if it exists
        const framesDir = path.join(os.tmpdir(), `frames_${Date.now()}`)
        if (fs.existsSync(framesDir)) {
          const files = fs.readdirSync(framesDir)
          for (const file of files) {
            fs.unlinkSync(path.join(framesDir, file))
          }
          fs.rmdirSync(framesDir)
        }
      } catch (error) {
        this.logger.error('Error cleaning up files:', { error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
}
