/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    '/**': ['./CHANGELOG.md'],
  },
}

module.exports = nextConfig
