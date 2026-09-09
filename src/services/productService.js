const ProductModel = require('../models/productModel');

class ProductService {
  static async getAllProducts() {
    const products = await ProductModel.findAll();
    return products.map(product => ({
      ...product,
      price: parseFloat(product.price)
    }));
  }
}

module.exports = ProductService;
