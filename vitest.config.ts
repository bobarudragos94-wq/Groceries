import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // fiecare fișier în proces separat — testele de integrare își setează
    // propria bază de date prin variabile de mediu înainte de import
    pool: 'forks'
  }
});
