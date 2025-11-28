/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary Blue (BlockStar Blue)
        primary: {
          50: '#e6f0ff',
          100: '#cce0ff',
          200: '#99c2ff',
          300: '#66a3ff',
          400: '#3385ff',
          500: '#0066FF', // Main BlockStar Blue
          600: '#0052cc',
          700: '#003d99',
          800: '#002966',
          900: '#001433',
        },
        // Cyan accent
        cyan: {
          50: '#e6fbff',
          100: '#ccf7ff',
          200: '#99efff',
          300: '#66e7ff',
          400: '#33dfff',
          500: '#00c8ff', // Main cyan
          600: '#00a0cc',
          700: '#007899',
          800: '#005066',
          900: '#002833',
        },
        // Dark backgrounds
        dark: {
          50: '#1a1a2e',
          100: '#12121f',
          200: '#0a0a12',
          300: '#06060c',
          400: '#030308',
          500: '#000000', // Pure black
        },
        // Success green
        success: {
          400: '#00ff9d',
          500: '#00d67f',
          600: '#00a862',
        },
        // Error red
        danger: {
          400: '#ff5c7a',
          500: '#ff3b5c',
          600: '#cc2f4a',
        },
        // Warning yellow
        warning: {
          400: '#ffc933',
          500: '#ffb800',
          600: '#cc9300',
        },
      },
      backgroundColor: {
        'midnight': '#000000',
        'midnight-light': '#030308',
        'card': '#06060c',
        'card-hover': '#0a0a12',
      },
      borderColor: {
        'midnight': '#12121f',
        'glow': '#0066FF',
      },
      textColor: {
        'primary': '#ffffff',
        'secondary': '#8a8a9a',
        'muted': '#4a4a5a',
      },
      boxShadow: {
        'glow': '0 0 20px rgba(0, 102, 255, 0.6)',
        'glow-lg': '0 0 40px rgba(0, 102, 255, 0.6), 0 0 60px rgba(0, 200, 255, 0.4)',
        'glow-cyan': '0 0 20px rgba(0, 200, 255, 0.4)',
        'glow-green': '0 0 20px rgba(0, 214, 127, 0.4)',
      },
      backgroundImage: {
        'gradient-blue': 'linear-gradient(135deg, #0066FF, #00c8ff)',
        'gradient-blue-dark': 'linear-gradient(135deg, #0052cc, #0066FF)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
