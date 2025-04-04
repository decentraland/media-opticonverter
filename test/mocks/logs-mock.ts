import { ILoggerComponent } from '@well-known-components/interfaces'

export function createLogsMockComponent(): ILoggerComponent {
  return {
    getLogger: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    })
  }
}
