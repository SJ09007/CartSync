import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * ProductPage Component for CartSync
 *
 * Features:
 * - Fetches products from GET /products on load
 * - Opens WebSocket connection to ws://localhost:5000 on mount
 * - Listens for {"productId": X, "newQty": Y} updates and updates local state without refresh
 * - "Buy" button per product calls POST /products/:id/buy
 * - Disables "Buy" and displays "Out of stock" when stock_qty === 0
 * - Gracefully handles 409 Out-of-Stock conflict (e.g. race conditions) with inline alerts
 * - Cleans up WebSocket connection on unmount
 * - Fully self-contained with modern, responsive styling
 */
export default function ProductPage({
  apiUrl = 'http://localhost:5000',
  wsUrl = 'ws://localhost:5000'
}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [wsStatus, setWsStatus] = useState('connecting'); // 'connecting' | 'connected' | 'disconnected' | 'error'
  
  // Track per-product purchase state: { [productId]: boolean }
  const [purchasingMap, setPurchasingMap] = useState({});
  
  // Track per-product inline feedback messages: { [productId]: { type: 'success' | 'error' | 'warning', text: string } }
  const [feedbackMap, setFeedbackMap] = useState({});
  
  // Track recently updated product IDs for flash/pulse animation
  const [flashMap, setFlashMap] = useState({});

  const wsRef = useRef(null);
  const feedbackTimersRef = useRef({});

  // Helper to show temporary inline feedback for a product
  const setInlineFeedback = useCallback((productId, type, text, durationMs = 5000) => {
    if (feedbackTimersRef.current[productId]) {
      clearTimeout(feedbackTimersRef.current[productId]);
    }

    setFeedbackMap(prev => ({
      ...prev,
      [productId]: { type, text }
    }));

    if (durationMs > 0) {
      feedbackTimersRef.current[productId] = setTimeout(() => {
        setFeedbackMap(prev => {
          const next = { ...prev };
          delete next[productId];
          return next;
        });
        delete feedbackTimersRef.current[productId];
      }, durationMs);
    }
  }, []);

  // Flash highlight on real-time stock change
  const triggerStockFlash = useCallback((productId) => {
    setFlashMap(prev => ({ ...prev, [productId]: true }));
    setTimeout(() => {
      setFlashMap(prev => ({ ...prev, [productId]: false }));
    }, 1200);
  }, []);

  // 1. Fetch initial products list
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const response = await fetch(`${apiUrl}/products`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const json = await response.json();
      const list = Array.isArray(json) ? json : (json.data || []);
      setProducts(list);
    } catch (err) {
      console.error('[CartSync] Failed to fetch products:', err);
      setFetchError(err.message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // 2. Manage WebSocket connection lifecycle
  useEffect(() => {
    let isMounted = true;
    setWsStatus('connecting');

    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      if (!isMounted) return;
      console.log('[CartSync WS] Connected to', wsUrl);
      setWsStatus('connected');
    };

    socket.onmessage = (event) => {
      if (!isMounted) return;
      try {
        const payload = JSON.parse(event.data);
        // Expecting { productId: X, newQty: Y }
        if (payload && payload.productId !== undefined && payload.newQty !== undefined) {
          const targetId = Number(payload.productId);
          const newStock = Number(payload.newQty);

          setProducts(prev =>
            prev.map(p => {
              if (Number(p.id) === targetId) {
                return { ...p, stock_qty: newStock };
              }
              return p;
            })
          );

          triggerStockFlash(targetId);
        }
      } catch (err) {
        console.warn('[CartSync WS] Could not parse message:', event.data, err);
      }
    };

    socket.onerror = (err) => {
      if (!isMounted) return;
      console.error('[CartSync WS] Socket error:', err);
      setWsStatus('error');
    };

    socket.onclose = () => {
      if (!isMounted) return;
      console.log('[CartSync WS] Connection closed');
      setWsStatus('disconnected');
    };

    // 7. Cleanup WebSocket on component unmount
    return () => {
      isMounted = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      // Clear any pending timers
      Object.values(feedbackTimersRef.current).forEach(clearTimeout);
    };
  }, [wsUrl, triggerStockFlash]);

  // 4. Handle Buy action
  const handleBuy = async (product) => {
    const productId = product.id;
    if (purchasingMap[productId] || product.stock_qty <= 0) return;

    // Set purchasing loading state for this card
    setPurchasingMap(prev => ({ ...prev, [productId]: true }));

    try {
      const response = await fetch(`${apiUrl}/products/${productId}/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      // 6. Handle 409 Conflict (Out of stock race condition)
      if (response.status === 409) {
        const errData = await response.json().catch(() => ({}));
        console.warn(`[CartSync] Product ${productId} out of stock (409):`, errData);

        // Update local state to 0 immediately so UI disables the button
        setProducts(prev =>
          prev.map(p => (Number(p.id) === Number(productId) ? { ...p, stock_qty: 0 } : p))
        );

        setInlineFeedback(
          productId,
          'error',
          'Out of stock! Another customer just purchased the last item.'
        );
        return;
      }

      if (response.status === 404) {
        setInlineFeedback(productId, 'error', 'Product not found.');
        return;
      }

      if (!response.ok) {
        throw new Error(`Server returned error: ${response.status}`);
      }

      // Successful purchase
      const data = await response.json();
      if (data && data.newQty !== undefined) {
        // Immediate local state update (WS message will also sync across tabs)
        setProducts(prev =>
          prev.map(p =>
            Number(p.id) === Number(productId) ? { ...p, stock_qty: Number(data.newQty) } : p
          )
        );
      }

      setInlineFeedback(productId, 'success', 'Order placed successfully! 🛒');
    } catch (err) {
      console.error(`[CartSync] Error purchasing product ${productId}:`, err);
      setInlineFeedback(productId, 'error', 'Purchase failed. Please try again.');
    } finally {
      setPurchasingMap(prev => ({ ...prev, [productId]: false }));
    }
  };

  return (
    <div style={styles.container}>
      {/* Inline styles for transitions and animations */}
      <style>{`
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); transform: scale(1); }
          50% { box-shadow: 0 0 16px 4px rgba(59, 130, 246, 0.4); transform: scale(1.02); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); transform: scale(1); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .cs-product-card {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .cs-product-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
        }
        .cs-btn-buy {
          transition: all 0.18s ease;
        }
        .cs-btn-buy:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.1);
        }
        .cs-btn-buy:active:not(:disabled) {
          transform: translateY(1px);
        }
      `}</style>

      {/* Header section */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoBadge}>⚡</div>
          <div>
            <h1 style={styles.title}>CartSync Live Store</h1>
            <p style={styles.subtitle}>Instant multi-tab inventory sync powered by WebSockets</p>
          </div>
        </div>

        {/* WebSocket Live Status Indicator */}
        <div style={styles.headerRight}>
          <div style={styles.statusIndicator}>
            <span
              style={{
                ...styles.statusDot,
                backgroundColor:
                  wsStatus === 'connected'
                    ? '#10b981'
                    : wsStatus === 'connecting'
                    ? '#f59e0b'
                    : '#ef4444'
              }}
            />
            <span style={styles.statusText}>
              {wsStatus === 'connected' && 'Live Sync Active'}
              {wsStatus === 'connecting' && 'Connecting...'}
              {wsStatus === 'disconnected' && 'Live Sync Offline'}
              {wsStatus === 'error' && 'Sync Error'}
            </span>
          </div>

          <button
            onClick={fetchProducts}
            style={styles.refreshButton}
            title="Refresh product list"
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={styles.main}>
        {/* Loading Spinner */}
        {loading && (
          <div style={styles.centerBox}>
            <div style={styles.spinner} />
            <p style={{ marginTop: '16px', color: '#94a3b8' }}>Loading products...</p>
          </div>
        )}

        {/* Fetch Error */}
        {fetchError && !loading && (
          <div style={styles.errorBox}>
            <p style={styles.errorBoxText}>⚠️ {fetchError}</p>
            <button onClick={fetchProducts} style={styles.retryButton}>
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !fetchError && products.length === 0 && (
          <div style={styles.centerBox}>
            <p style={{ color: '#94a3b8', fontSize: '18px' }}>No products available.</p>
          </div>
        )}

        {/* Product Cards Grid */}
        {!loading && !fetchError && products.length > 0 && (
          <div style={styles.grid}>
            {products.map((product) => {
              const isOutOfStock = product.stock_qty <= 0;
              const isPurchasing = !!purchasingMap[product.id];
              const feedback = feedbackMap[product.id];
              const isFlashing = !!flashMap[product.id];

              return (
                <div
                  key={product.id}
                  className="cs-product-card"
                  style={{
                    ...styles.card,
                    ...(isFlashing ? { animation: 'pulseGlow 1.2s ease' } : {}),
                    ...(isOutOfStock ? styles.cardOutOfStock : {})
                  }}
                >
                  {/* Card Header: Product ID badge & Stock Status Pill */}
                  <div style={styles.cardTopRow}>
                    <span style={styles.idBadge}>#{product.id}</span>
                    <span
                      style={{
                        ...styles.stockBadge,
                        ...(isOutOfStock
                          ? styles.stockBadgeOut
                          : product.stock_qty <= 5
                          ? styles.stockBadgeLow
                          : styles.stockBadgeOk)
                      }}
                    >
                      {isOutOfStock
                        ? 'Out of Stock'
                        : product.stock_qty <= 5
                        ? `Only ${product.stock_qty} left!`
                        : `${product.stock_qty} in stock`}
                    </span>
                  </div>

                  {/* Product Title */}
                  <h3 style={styles.productName}>{product.name}</h3>

                  {/* Pricing & Stock Details */}
                  <div style={styles.priceRow}>
                    <div style={styles.priceContainer}>
                      <span style={styles.currency}>$</span>
                      <span style={styles.priceAmount}>
                        {Number(product.price).toFixed(2)}
                      </span>
                    </div>

                    <div style={styles.stockCounter}>
                      <span style={styles.stockLabel}>Available</span>
                      <span
                        style={{
                          ...styles.stockValue,
                          color: isOutOfStock
                            ? '#f87171'
                            : product.stock_qty <= 5
                            ? '#fbbf24'
                            : '#34d399'
                        }}
                      >
                        {product.stock_qty}
                      </span>
                    </div>
                  </div>

                  {/* Inline Feedback Banner (e.g. 409 Out of stock or success) */}
                  {feedback && (
                    <div
                      style={{
                        ...styles.inlineFeedback,
                        ...(feedback.type === 'error'
                          ? styles.feedbackError
                          : feedback.type === 'warning'
                          ? styles.feedbackWarning
                          : styles.feedbackSuccess)
                      }}
                    >
                      <span style={{ marginRight: '6px' }}>
                        {feedback.type === 'error' ? '⚠️' : '✅'}
                      </span>
                      <span>{feedback.text}</span>
                    </div>
                  )}

                  {/* Action Button */}
                  <button
                    onClick={() => handleBuy(product)}
                    disabled={isOutOfStock || isPurchasing}
                    className="cs-btn-buy"
                    style={{
                      ...styles.buyButton,
                      ...(isOutOfStock
                        ? styles.buyButtonDisabled
                        : isPurchasing
                        ? styles.buyButtonLoading
                        : styles.buyButtonActive)
                    }}
                  >
                    {isPurchasing ? (
                      <span style={styles.buttonContent}>
                        <span style={styles.btnSpinner} />
                        Processing...
                      </span>
                    ) : isOutOfStock ? (
                      'Out of stock'
                    ) : (
                      <span style={styles.buttonContent}>
                        Buy Now ⚡
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

// Named export for flexibility
export { ProductPage };

// Stylesheet definition
const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    padding: '32px 24px',
    boxSizing: 'border-box'
  },
  header: {
    maxWidth: '1200px',
    margin: '0 auto 36px auto',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '20px',
    borderBottom: '1px solid #1e293b',
    paddingBottom: '24px'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  logoBadge: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)'
  },
  title: {
    margin: 0,
    fontSize: '26px',
    fontWeight: '700',
    letterSpacing: '-0.5px',
    background: 'linear-gradient(to right, #ffffff, #cbd5e1)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent'
  },
  subtitle: {
    margin: '4px 0 0 0',
    fontSize: '14px',
    color: '#94a3b8'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 14px',
    borderRadius: '20px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155'
  },
  statusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    display: 'inline-block'
  },
  statusText: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#e2e8f0'
  },
  refreshButton: {
    background: '#1e293b',
    border: '1px solid #334155',
    color: '#cbd5e1',
    borderRadius: '8px',
    padding: '7px 14px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '24px'
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: '16px',
    padding: '24px',
    border: '1px solid #334155',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    boxSizing: 'border-box'
  },
  cardOutOfStock: {
    borderColor: '#3f2c35',
    backgroundColor: '#1a1d2e'
  },
  cardTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '14px'
  },
  idBadge: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase'
  },
  stockBadge: {
    fontSize: '12px',
    fontWeight: '600',
    padding: '4px 10px',
    borderRadius: '12px'
  },
  stockBadgeOk: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#34d399',
    border: '1px solid rgba(16, 185, 129, 0.3)'
  },
  stockBadgeLow: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    color: '#fbbf24',
    border: '1px solid rgba(245, 158, 11, 0.3)'
  },
  stockBadgeOut: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: '#f87171',
    border: '1px solid rgba(239, 68, 68, 0.3)'
  },
  productName: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#f8fafc',
    margin: '0 0 16px 0',
    lineHeight: '1.4',
    minHeight: '50px'
  },
  priceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: '20px',
    paddingBottom: '16px',
    borderBottom: '1px solid #334155'
  },
  priceContainer: {
    display: 'flex',
    alignItems: 'baseline'
  },
  currency: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#94a3b8',
    marginRight: '2px'
  },
  priceAmount: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#f8fafc',
    letterSpacing: '-0.5px'
  },
  stockCounter: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end'
  },
  stockLabel: {
    fontSize: '11px',
    textTransform: 'uppercase',
    color: '#64748b',
    fontWeight: '600'
  },
  stockValue: {
    fontSize: '16px',
    fontWeight: '700'
  },
  inlineFeedback: {
    padding: '10px 12px',
    borderRadius: '8px',
    fontSize: '13px',
    lineHeight: '1.4',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center'
  },
  feedbackError: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: '#fca5a5',
    border: '1px solid rgba(239, 68, 68, 0.3)'
  },
  feedbackSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#6ee7b7',
    border: '1px solid rgba(16, 185, 129, 0.3)'
  },
  feedbackWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    color: '#fde68a',
    border: '1px solid rgba(245, 158, 11, 0.3)'
  },
  buyButton: {
    width: '100%',
    padding: '12px',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: '600',
    border: 'none',
    cursor: 'pointer',
    marginTop: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    outline: 'none'
  },
  buyButtonActive: {
    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    color: '#ffffff',
    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)'
  },
  buyButtonDisabled: {
    backgroundColor: '#334155',
    color: '#64748b',
    cursor: 'not-allowed',
    boxShadow: 'none'
  },
  buyButtonLoading: {
    backgroundColor: '#1d4ed8',
    color: '#e2e8f0',
    cursor: 'wait'
  },
  buttonContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  centerBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 20px'
  },
  spinner: {
    width: '36px',
    height: '36px',
    border: '3px solid rgba(255, 255, 255, 0.15)',
    borderTop: '3px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  btnSpinner: {
    width: '16px',
    height: '16px',
    border: '2px solid rgba(255, 255, 255, 0.3)',
    borderTop: '2px solid #ffffff',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin 0.8s linear infinite'
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '12px',
    padding: '24px',
    textAlign: 'center',
    maxWidth: '480px',
    margin: '40px auto'
  },
  errorBoxText: {
    color: '#f87171',
    margin: '0 0 16px 0',
    fontSize: '15px'
  },
  retryButton: {
    backgroundColor: '#ef4444',
    color: '#ffffff',
    border: 'none',
    padding: '8px 18px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  }
};
