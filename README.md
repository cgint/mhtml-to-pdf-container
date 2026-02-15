# MHT to PDF Converter

A lightweight HTTP service that converts MHT (MIME HTML) archive files to PDF documents. This service is designed to run in a Docker container and provides a simple REST API for file conversion.

## What is this?

This service takes MHT files - which are self-contained web archives that bundle HTML, CSS, images, and other resources into a single file - and converts them into properly formatted PDF documents. It's particularly useful for:

- Converting saved web pages to PDF format
- Archiving web content in a more portable format
- Batch processing of MHT files through API calls
- Integration into document processing workflows

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone and start the service
git clone <repository-url>
cd mhtml-to-pdf-container
docker compose up -d --build

# Test the service
curl -X POST -F file=@your-file.mht http://localhost:9111/mht-to-pdf -o output.pdf
```

### Using Docker

```bash
# Build the image
docker build -t mht-to-pdf:latest .

# Run the container
docker run -p 8080:8080 mht-to-pdf:latest

# Test the service
curl -X POST -F file=@your-file.mht http://localhost:8080/mht-to-pdf -o output.pdf
```

## API Reference

### Convert MHT to PDF

**Endpoint:** `POST /mht-to-pdf`

**Request:**
- **Method:** POST
- **Content-Type:** multipart/form-data
- **Body:**
  - `file`: The MHT file to convert (required)
  - `page_size`: PDF page size (optional, default: A4)
  - `margin_top`: Top margin in mm (optional)
  - `margin_bottom`: Bottom margin in mm (optional)
  - `margin_left`: Left margin in mm (optional)
  - `margin_right`: Right margin in mm (optional)
  - `dpi`: DPI for rendering (optional)
  - `disable_smart_shrinking`: Disable smart shrinking (optional, true/false)

**Response:**
- **Content-Type:** application/pdf
- **Body:** The converted PDF file
- **Headers:**
  - `X-Request-Id`: Unique identifier for the request

**Example:**
```bash
curl -X POST \
  -F "file=@document.mht" \
  -F "page_size=A4" \
  -F "margin_top=20" \
  -F "margin_bottom=20" \
  http://localhost:8080/mht-to-pdf \
  -o output.pdf
```

### Health Check

**Endpoint:** `GET /healthz`

Returns the service health status.

**Response:**
```json
{
  "status": "ok"
}
```

## Configuration

The service can be configured using environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Server port |
| `MAX_UPLOAD_MB` | 25 | Maximum file upload size in MB |
| `JOB_TIMEOUT_MS` | 120000 | Maximum processing time per file in milliseconds |
| `DEFAULT_PAGE_SIZE` | A4 | Default PDF page size |
| `DEFAULT_MARGINS_MM` | 10 | Default page margins in mm |
| `RENDERER` | chromium | PDF renderer to use |
| `KEEP_JOBS` | 0 | Keep temporary files for debugging (1=true, 0=false) |

## Development

### Prerequisites
- Node.js 18 or higher
- Docker and Docker Compose

### Local Development

```bash
# Install dependencies
npm install

# Start the service locally
npm start

# The service will be available at http://localhost:8080
```

### Testing

The repository includes a test script that demonstrates usage:

```bash
# Run the test script
./run_test.sh

# Or test with a custom MHT file
./run_test.sh /path/to/your/file.mht
```

### Release (build + push)

Assumes you are already authenticated to Docker Hub.

```bash
./release.sh
# or
TAG=latest ./release.sh
```

Optional multi-arch push:

```bash
PLATFORMS=linux/amd64,linux/arm64 TAG=latest ./release.sh
```

## Architecture

The service uses a two-step conversion process:

1. **MHT Processing**: The MHT file is processed using headless Chromium to render the content
2. **PDF Generation**: The rendered content is converted to PDF format with configurable options

### Dependencies

- **Express.js**: Web server framework
- **Multer**: File upload handling
- **Pino**: Structured logging
- **Chromium**: Headless browser for rendering
- **Poppler**: PDF utilities for validation

## Deployment

### Docker Deployment

The service is designed to run in a Docker container with all dependencies included. The container includes:

- Alpine Linux base image
- Node.js runtime
- Chromium browser
- Required fonts for broad Unicode support
- PDF processing utilities

### Cloud Deployment

The service can be deployed to any cloud platform that supports Docker containers. Example configurations are provided for:

- **Docker Compose**: Local development and testing
- **Kubernetes**: Scalable cloud deployment
- **Serverless platforms**: AWS Lambda, Google Cloud Run, etc.

## Troubleshooting

### Common Issues

**File upload fails:**
- Check file size against `MAX_UPLOAD_MB` limit
- Ensure the file has `.mht` or `.mhtml` extension

**Conversion timeout:**
- Increase `JOB_TIMEOUT_MS` for large files
- Check system resources and memory usage

**PDF generation fails:**
- Verify Chromium is properly installed
- Check file permissions and disk space

### Debugging

Enable debug logging by setting the environment variable:
```bash
LOG_LEVEL=debug npm start
```

Keep temporary files for inspection:
```bash
KEEP_JOBS=1 npm start
```

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions, please open an issue on the GitHub repository.
