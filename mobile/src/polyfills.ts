// mobile/src/polyfills.ts
import 'react-native-get-random-values';

// Polyfill for global atob/btoa if needed
if (typeof global.atob === 'undefined') {
  global.atob = (str: string) => {
    return Buffer.from(str, 'base64').toString('binary');
  };
}

if (typeof global.btoa === 'undefined') {
  global.btoa = (str: string) => {
    return Buffer.from(str, 'binary').toString('base64');
  };
}

// Export so it can be imported
export {};
