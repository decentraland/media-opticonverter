# Media OptiConverter

A service that converts and optimizes media files (images and videos) for web use. It supports various formats including SVG, PNG, WebP, JPG, JPEG, GIF, and KTX2.

## Features

- Converts between multiple image formats (SVG, PNG, WebP, JPG, JPEG)
- Converts animated GIFs to MP4
- Converts images to KTX2 format for 3D/WebGL use
- Optimizes file sizes while maintaining quality
- Supports both S3 and local storage
- Handles animated WebP files

## Supported Conversions

### Image Formats
- SVG → PNG
- PNG → PNG (optimized)
- WebP → PNG
- JPG/JPEG → PNG
- Any image → KTX2 (when ktx2Enabled is true)

### Video Formats
- GIF → MP4
- Animated WebP → MP4

## Running the Application

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Build the application:
```bash
npm run build
```

3. Start the service:
```bash
npm start
```

For local storage mode:
```bash
npm run start:local
```

### Docker

1. Build the Docker image:
```bash
docker build -t media-opticonverter .
```

2. Run the container:
```bash
docker run -p 8000:8000 media-opticonverter
```

## Testing

### Local Tests

Run tests locally:
```bash
npm test
```

### Docker Tests

Run tests in Docker environment:
```bash
npm run test:docker
```

## API Endpoints

### GET /convert
Converts a media file to the appropriate format and returns a 302 redirect to the converted file.

**Query Parameters:**
- `fileUrl`: URL of the file to convert
- `ktx2`: (optional) Set to 'true' to convert to KTX2 format

**Response:**
- Status: 302 (Redirect)
- Headers:
  - `Location`: URL of the converted file
  - `Access-Control-Allow-Origin`: '*'
  - `Cache-Control`: 'public, max-age=31536000'

**Examples:**
```bash
# Convert a PNG to WebP
curl "http://localhost:8000/convert?fileUrl=http://localhost:8000/test/assets/test.png"
# Response: 302 redirect to http://localhost:8000/storage/[hash].png

# Convert an animated GIF to MP4
curl "http://localhost:8000/convert?fileUrl=http://localhost:8000/test/assets/test.gif"
# Response: 302 redirect to http://localhost:8000/storage/[hash].mp4

# Convert a WebP to PNG
curl "http://localhost:8000/convert?fileUrl=http://localhost:8000/test/assets/test.webp"
# Response: 302 redirect to http://localhost:8000/storage/[hash].png

# Convert an SVG to KTX2
curl "http://localhost:8000/convert?fileUrl=http://localhost:8000/test/assets/test.svg&ktx2=true"
# Response: 302 redirect to http://localhost:8000/storage/[hash].ktx2
```

### POST /convert
Converts a media file to the appropriate format and returns the URL of the converted file.

**Request Body:**
```json
{
  "fileUrl": "string",    // URL of the file to convert
  "ktx2": boolean        // Optional: Enable KTX2 conversion (default: false)
}
```

**Response:**
```json
{
  "url": "string"  // URL of the converted file
}
```

**Examples:**
```bash
# Convert a PNG to WebP
curl -X POST http://localhost:8000/convert \
  -H "Content-Type: application/json" \
  -d '{
    "fileUrl": "http://localhost:8000/test/assets/test.png"
  }'

# Convert an animated GIF to MP4
curl -X POST http://localhost:8000/convert \
  -H "Content-Type: application/json" \
  -d '{
    "fileUrl": "http://localhost:8000/test/assets/test.gif"
  }'

# Convert a WebP to PNG
curl -X POST http://localhost:8000/convert \
  -H "Content-Type: application/json" \
  -d '{
    "fileUrl": "http://localhost:8000/test/assets/test.webp"
  }'

# Convert an SVG to KTX2
curl -X POST http://localhost:8000/convert \
  -H "Content-Type: application/json" \
  -d '{
    "fileUrl": "http://localhost:8000/test/assets/test.svg",
    "ktx2": true
  }'
```

### GET /ping
Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

**Example:**
```bash
curl http://localhost:8000/ping
```

## Environment Variables

- `USE_LOCAL_STORAGE`: Set to `true` to use local storage instead of S3
- `AWS_REGION`: AWS region for S3 (default: us-east-1)
- `BUCKET_NAME`: S3 bucket name
- `CLOUDFRONT_DOMAIN`: CloudFront domain for serving files

## Architecture

Extension of "ports and adapters architecture", also known as "hexagonal architecture".

With this architecture, code is organized into several layers: logic, controllers, adapters, and components (ports).

## Application lifecycle

1. **Start application lifecycle** - Handled by [src/index.ts](src/index.ts) in only one line of code: `Lifecycle.run({ main, initComponents })`
2. **Create components** - Handled by [src/components.ts](src/components.ts) in the function `initComponents`
3. **Wire application & start components** - Handled by [src/service.ts](src/service.ts) in the funciton `main`.
   1. First wire HTTP routes and other events with [controllers](#src/controllers)
   2. Then call to `startComponents()` to initialize the components (i.e. http-listener)

The same lifecycle is also valid for tests: [test/components.ts](test/components.ts)

## Namespaces

### src/logic

Deals with pure business logic and shouldn't have side-effects or throw exceptions.

### src/controllers

The "glue" between all the other layers, orchestrating calls between pure business logic and adapters.

Controllers always receive an hydrated context containing components and parameters to call the business logic e.g:

```ts
// handler for /ping
export async function pingHandler(context: {
  url: URL // parameter added by http-server
  components: AppComponents // components of the app, part of the global context
}) {
  components.metrics.increment("test_ping_counter")
  return { status: 200 }
}
```

### src/adapters

The layer that converts external data representations into internal ones, and vice-versa. Acts as buffer to protect the service from changes in the outside world; when a data representation changes, you only need to change how the adapters deal with it.

### src/components.ts

We use the components abstraction to organize our adapters (e.g. HTTP client, database client, redis client) and any other logic that needs to track mutable state or encode dependencies between stateful components. For every environment (e.g. test, e2e, prod, staging...) we have a different version of our component systems, enabling us to easily inject mocks or different implementations for different contexts.

We make components available to incoming http and kafka handlers. For instance, the http-server handlers have access to things like the database or HTTP components, and pass them down to the controller level for general use.
