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
}

module.exports = ProductModel;
