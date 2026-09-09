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

module.exports = router;
