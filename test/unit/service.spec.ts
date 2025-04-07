import { main } from '../../src/service'
import { setupRouter } from '../../src/controllers/routes'
import { createLogsMockComponent } from '../mocks/logs-mock'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import { metricDeclarations } from '../../src/metrics'

// Mock the router setup
jest.mock('../../src/controllers/routes')

describe('Service Unit Tests', () => {
  const mockSetupRouter = setupRouter as jest.Mock
  const mockRouter = {
    middleware: jest.fn().mockReturnValue('middleware'),
    allowedMethods: jest.fn().mockReturnValue('allowedMethods')
  }
  const mockUse = jest.fn()
  const mockSetContext = jest.fn()
  const mockStartComponents = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockSetupRouter.mockResolvedValue(mockRouter)
  })

  it('should wire up components and start the service', async () => {
    // Arrange
    const components = {
      logs: createLogsMockComponent(),
      metrics: createTestMetricsComponent(metricDeclarations),
      server: {
        use: mockUse,
        setContext: mockSetContext
      }
    }

    // Act
    await main({
      components: components as any,
      startComponents: mockStartComponents,
      stop: jest.fn()
    })

    // Assert
    expect(setupRouter).toHaveBeenCalledWith({ components })
    expect(mockRouter.middleware).toHaveBeenCalled()
    expect(mockRouter.allowedMethods).toHaveBeenCalled()
    expect(mockUse).toHaveBeenCalledWith('middleware')
    expect(mockUse).toHaveBeenCalledWith('allowedMethods')
    expect(mockSetContext).toHaveBeenCalledWith({ components })
    expect(mockStartComponents).toHaveBeenCalled()
  })
}) 