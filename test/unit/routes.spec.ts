// Set up mock functions for router
const mockGet = jest.fn()
const mockPost = jest.fn()

// First mock all dependencies to avoid import issues
jest.mock('@well-known-components/http-server', () => ({
  Router: jest.fn().mockImplementation(() => ({
    get: mockGet,
    post: mockPost
  }))
}))

jest.mock('../../src/metrics', () => ({
  metricDeclarations: {}
}))

jest.mock('../../src/controllers/handlers/ping-handler')
jest.mock('../../src/controllers/handlers/convert-handler')
jest.mock('../../src/controllers/handlers/storage-handler')

// Then import dependencies
import { setupRouter } from '../../src/controllers/routes'
import { createLogsMockComponent } from '../mocks/logs-mock'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import { metricDeclarations } from '../../src/metrics'
import { pingHandler } from '../../src/controllers/handlers/ping-handler'
import { convertHandler } from '../../src/controllers/handlers/convert-handler'
import { storageHandler } from '../../src/controllers/handlers/storage-handler'

describe('Routes Unit Tests', () => {
  const mockPingHandler = pingHandler as jest.Mock
  const mockConvertHandler = convertHandler as jest.Mock
  const mockStorageHandler = storageHandler as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should set up routes with local storage disabled', async () => {
    const globalContext = {
      components: {
        logs: createLogsMockComponent(),
        metrics: createTestMetricsComponent(metricDeclarations),
        config: {
          getString: jest.fn().mockResolvedValue('false'),
          requireString: jest.fn().mockResolvedValue('s3bucket')
        }
      }
    }

    await setupRouter(globalContext as any)

    // Verify ping route
    expect(mockGet).toHaveBeenCalledWith('/ping', mockPingHandler)

    // Verify GET convert route
    expect(mockGet).toHaveBeenCalledWith('/convert', mockConvertHandler)

    // Verify POST convert route
    expect(mockPost).toHaveBeenCalledWith('/convert', mockConvertHandler)

    // Storage route should not be added
    expect(mockGet).not.toHaveBeenCalledWith('/storage/:filename', mockStorageHandler)
  })

  it('should set up routes with local storage enabled', async () => {
    const globalContext = {
      components: {
        logs: createLogsMockComponent(),
        metrics: createTestMetricsComponent(metricDeclarations),
        config: {
          getString: jest.fn().mockResolvedValue('true'),
          requireString: jest.fn().mockResolvedValue('bucket')
        }
      }
    }

    await setupRouter(globalContext as any)

    // Verify storage route is added when local storage is enabled
    expect(mockGet).toHaveBeenCalledWith('/storage/:filename', mockStorageHandler)
  })
})
