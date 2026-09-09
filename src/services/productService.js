const ProductModel = require('../models/productModel');
const { publisher } = require('../redis/redisClient');

const STOCK_CHANNEL = 'stock-updates';

class ProductService {
  static async getAllProducts() {
    const products = await ProductModel.findAll();
    return products.map(product => ({
      ...product,
      price: parseFloat(product.price)
    }));
  }

  /**
   * Atomically purchase one unit of a product.
   *
   * @param {number|string} id  - Product ID
   * @returns {{ productId: number, newQty: number }}
   * @throws {{ code: 'NOT_FOUND' }}    when the product does not exist
   * @throws {{ code: 'OUT_OF_STOCK' }} when stock_qty is already 0
   */
  static async buyProduct(id) {
    // Attempt the atomic decrement first for the common happy-path.
    const updated = await ProductModel.buyProduct(id);

    if (updated) {
      const result = { productId: Number(id), newQty: updated.stock_qty };

      // Publish stock-update event to Redis so the broadcaster can fan it
      // out to all WebSocket clients.  productService never touches WS directly.
      const payload = JSON.stringify(result);
      publisher.publish(STOCK_CHANNEL, payload).catch((err) => {
        console.error('[ProductService] Failed to publish stock update to Redis:', err.message);
      });

      return result;
    }

    // 0 rows affected — could be not-found OR out-of-stock.
    // Do a cheap existence check to tell them apart.
    const exists = await ProductModel.findById(id);
    if (!exists) {
      const err = new Error('Product not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const err = new Error('out of stock');
    err.code = 'OUT_OF_STOCK';
    throw err;
  }
}

module.exports = ProductService;
