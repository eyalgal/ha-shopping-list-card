import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/shopping-list-card.js',
  output: {
    file: 'shopping-list-card.js',
    format: 'es',
  },
  plugins: [
    resolve(),
    // terser()
  ]
};
