/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['cards.scryfall.io', 'c1.scryfall.com', 'c2.scryfall.com', 'svgs.scryfall.io'],
  },
}

module.exports = nextConfig
