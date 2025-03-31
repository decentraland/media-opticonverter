import { HandlerContextWithPath } from '../../types'
import { MediaConverter } from '../../adapters/media-converter'

export async function convertHandler(
  context: HandlerContextWithPath<'config' | 'logs' | 'metrics' | 'fetch' | 'server' | 'statusChecks', '/convert'>
) {
  const { components, request } = context
  let fileUrl: string | undefined
  let ktx2: boolean | undefined

  if (request.method === 'GET') {
    const url = new URL(request.url)
    fileUrl = url.searchParams.get('fileUrl') || undefined
    ktx2 = url.searchParams.get('ktx2') === 'true'
  } else {
    const body = await request.json()
    fileUrl = body.fileUrl
    ktx2 = body.ktx2
  }

  if (!fileUrl) {
    return {
      status: 400,
      body: { error: 'fileUrl is required' }
    }
  }

  try {
    const bucket = await components.config.requireString('S3_BUCKET')
    const cloudfrontDomain = await components.config.requireString('CLOUDFRONT_DOMAIN')
    const region = await components.config.requireString('AWS_REGION')
    const useLocalStorage = (await components.config.getString('USE_LOCAL_STORAGE')) === 'true'

    const converter = new MediaConverter(bucket, cloudfrontDomain, region, components, useLocalStorage)
    const result = await converter.convert(fileUrl, ktx2)

    return {
      status: 200,
      body: { url: result }
    }
  } catch (error) {
    console.error('Error processing request:', error)
    return {
      status: 500,
      body: { error: error instanceof Error ? error.message : 'Internal server error' }
    }
  }
}
