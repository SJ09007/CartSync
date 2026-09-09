const express = require('express');
const router = express.Router();
const ProductService = require('../services/productService');

// GET /products
router.get('/', async (req, res, next) => {
  try {
    const products = await ProductService.getAllProducts();
    res.json({
      success: true,
      data: products
    });
  } catch (err) {
    next(err);
  }
});

// POST /products/:id/buy
router.post('/:id/buy', async (req, res, next) => {
  try {
    const result = await ProductService.buyProduct(req.params.id);
    return res.status(200).json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Product not found' });
    }
    if (err.code === 'OUT_OF_STOCK') {
      return res.status(409).json({ error: 'out of stock' });
    }
    next(err);
  }
});

module.exports = router;
