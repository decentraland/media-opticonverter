import { initComponents } from '../../src/components'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import {
  createServerComponent,
  createStatusCheckComponent,
  instrumentHttpServerWithPromClientRegistry
} from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createFetchComponent } from '@well-known-components/fetch-component'

// Mock all dependencies
jest.mock('@well-known-components/env-config-provider')
jest.mock('@well-known-components/http-server')
jest.mock('@well-known-components/logger')
jest.mock('@well-known-components/metrics')
jest.mock('@well-known-components/fetch-component')

describe('Components Unit Tests', () => {
  const mockConfig = { mock: 'config' }
  const mockMetrics = { registry: { mock: 'registry' }, mock: 'metrics' }
  const mockLogs = { mock: 'logs' }
  const mockServer = { mock: 'server' }
  const mockStatusChecks = { mock: 'statusChecks' }
  const mockFetch = { mock: 'fetch' }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mocks
    const mockCreateDotEnvConfig = createDotEnvConfigComponent as jest.Mock
    mockCreateDotEnvConfig.mockResolvedValue(mockConfig)

    const mockCreateMetrics = createMetricsComponent as jest.Mock
    mockCreateMetrics.mockResolvedValue(mockMetrics)

    const mockCreateLog = createLogComponent as jest.Mock
    mockCreateLog.mockResolvedValue(mockLogs)

    const mockCreateServer = createServerComponent as jest.Mock
    mockCreateServer.mockResolvedValue(mockServer)

    const mockCreateStatusCheck = createStatusCheckComponent as jest.Mock
    mockCreateStatusCheck.mockResolvedValue(mockStatusChecks)

    const mockCreateFetch = createFetchComponent as jest.Mock
    mockCreateFetch.mockReturnValue(mockFetch)

    const mockInstrument = instrumentHttpServerWithPromClientRegistry as jest.Mock
    mockInstrument.mockResolvedValue(undefined)
  })

  it('should initialize all components correctly', async () => {
    const components = await initComponents()

    // Verify all components are initialized
    expect(createDotEnvConfigComponent).toHaveBeenCalledWith({ path: ['.env.default', '.env'] })
    expect(createMetricsComponent).toHaveBeenCalled()
    expect(createLogComponent).toHaveBeenCalledWith({ metrics: mockMetrics })
    expect(createServerComponent).toHaveBeenCalled()
    expect(createStatusCheckComponent).toHaveBeenCalledWith({ server: mockServer, config: mockConfig })
    expect(createFetchComponent).toHaveBeenCalled()
    expect(instrumentHttpServerWithPromClientRegistry).toHaveBeenCalledWith({
      metrics: mockMetrics,
      server: mockServer,
      config: mockConfig,
      registry: mockMetrics.registry
    })

    // Verify returned components
    expect(components).toEqual({
      config: mockConfig,
      logs: mockLogs,
      server: mockServer,
      statusChecks: mockStatusChecks,
      fetch: mockFetch,
      metrics: mockMetrics
    })
  })
})
