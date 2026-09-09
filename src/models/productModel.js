const db = require('../db');

class ProductModel {
  static async findAll() {
    const queryText = `
      SELECT id, name, price, stock_qty, updated_at
      FROM products
      ORDER BY id ASC;
    `;
    const { rows } = await db.query(queryText);
    return rows;
  }

  /**
   * Check whether a product row exists (regardless of stock level).
   * Used to distinguish "product not found" from "out of stock".
   */
  static async findById(id) {
    const { rows } = await db.query(
      'SELECT id FROM products WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Atomically decrement stock_qty by 1 if stock_qty > 0.
   * Returns the updated row, or null if the WHERE condition was not met
   * (i.e. stock is already 0).
   */
  static async buyProduct(id) {
    const { rows } = await db.query(
      `UPDATE products
          SET stock_qty  = stock_qty - 1,
              updated_at = NOW()
        WHERE id = $1
          AND stock_qty > 0
        RETURNING stock_qty`,
      [id]
    );
    return rows[0] || null;
  }
}

module.exports = ProductModel;
