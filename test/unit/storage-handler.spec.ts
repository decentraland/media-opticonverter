import { storageHandler } from '../../src/controllers/handlers/storage-handler'
import * as fs from 'fs'
import * as path from 'path'
import { createLogsMockComponent } from '../mocks/logs-mock'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import { metricDeclarations } from '../../src/metrics'

jest.mock('fs')
jest.mock('path')

describe('Storage Handler Unit Tests', () => {
  const components = {
    logs: createLogsMockComponent(),
    metrics: createTestMetricsComponent(metricDeclarations)
  }

  beforeEach(() => {
    jest.clearAllMocks()
    
    // Mock process.cwd() to return a predictable path
    jest.spyOn(process, 'cwd').mockReturnValue('/app')
    
    // Mock path.join to use real implementation
    jest.spyOn(path, 'join').mockImplementation((...args) => {
      return args.join('/')
    })
  })

  it('should return 404 when file does not exist', async () => {
    // Mock fs.existsSync to return false
    jest.spyOn(fs, 'existsSync').mockReturnValue(false)

    const context = {
      components,
      params: { filename: 'nonexistent.png' }
    }

    const result = await storageHandler(context as any)
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: 'File not found' })
    expect(fs.existsSync).toHaveBeenCalledWith('/app/storage/nonexistent.png')
  })

  it('should return file when it exists', async () => {
    // Mock fs.existsSync to return true
    jest.spyOn(fs, 'existsSync').mockReturnValue(true)
    
    // Mock fs.statSync to return file stats
    const mockStat = {
      size: 12345
    }
    jest.spyOn(fs, 'statSync').mockReturnValue(mockStat as any)

    // Mock createReadStream
    const mockStream = {}
    jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as any)

    const context = {
      components,
      params: { filename: 'testfile.png' }
    }

    const result = await storageHandler(context as any)
    expect(result.status).toBe(200)
    expect(result.headers['Content-Type']).toBe('application/octet-stream')
    expect(result.headers['Content-Length']).toBe('12345')
    expect(result.headers['Cache-Control']).toBe('public, max-age=31536000')
    expect(result.body).toBe(mockStream)
    expect(fs.createReadStream).toHaveBeenCalledWith('/app/storage/testfile.png')
  })
}) 