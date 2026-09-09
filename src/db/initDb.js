require('dotenv').config();
const { pool } = require('./index');

async function initDb() {
  const client = await pool.connect();
  try {
    console.log('Initializing database schema...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        stock_qty INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table "products" created or already exists.');

    // Check if table is empty
    const res = await client.query('SELECT COUNT(*) FROM products;');
    const count = parseInt(res.rows[0].count, 10);

    if (count === 0) {
      console.log('Seeding initial products data...');
      await client.query(`
        INSERT INTO products (name, price, stock_qty)
        VALUES 
          ('Wireless Mechanical Keyboard', 89.99, 45),
          ('Ergonomic Gaming Mouse', 49.50, 120),
          ('UltraWide 34" Monitor', 499.99, 15),
          ('USB-C Docking Station', 129.00, 30),
          ('Noise Cancelling Headphones', 199.99, 60);
      `);
      console.log('Initial products seeded successfully.');
    } else {
      console.log(`Table "products" already contains ${count} records.`);
    }

    console.log('Database initialization completed successfully.');
  } catch (err) {
    console.error('Error during database initialization:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  initDb();
}

module.exports = { initDb };
