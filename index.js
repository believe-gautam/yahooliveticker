// server.js - Working Backend Implementation
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');

// Note: For demo purposes, we'll simulate Yahoo Finance data since the protobuf setup can be complex
// In production, you'd use the actual Yahoo Finance WebSocket with protobuf

class YahooFinanceServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    
    // Client connections and subscriptions
    this.clients = new Map();
    this.activeSymbols = new Set();
    this.stockPrices = new Map(); // Store current prices
    this.priceUpdateInterval = null;
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.startPriceSimulation();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static('public')); // Serve static files
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        activeClients: this.clients.size,
        activeSymbols: Array.from(this.activeSymbols),
        timestamp: new Date().toISOString()
      });
    });

    // Get popular stocks for search suggestions
    this.app.get('/api/popular-stocks', (req, res) => {
      const popularStocks = [
        { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
        { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology' },
        { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology' },
        { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Discretionary' },
        { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Automotive' },
        { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology' },
        { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology' },
        { symbol: 'NFLX', name: 'Netflix Inc.', sector: 'Entertainment' },
        { symbol: 'BTC-USD', name: 'Bitcoin USD', sector: 'Cryptocurrency' },
        { symbol: 'ETH-USD', name: 'Ethereum USD', sector: 'Cryptocurrency' },
        { symbol: 'GOOG', name: 'Alphabet Inc. Class C', sector: 'Technology' },
        { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial' },
        { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
        { symbol: 'V', name: 'Visa Inc.', sector: 'Financial' },
        { symbol: 'PG', name: 'Procter & Gamble Co.', sector: 'Consumer Goods' }
      ];
      res.json(popularStocks);
    });

    // Search stocks endpoint
    this.app.get('/api/search/:query', (req, res) => {
      const query = req.params.query.toLowerCase();
      const allStocks = [
        { symbol: 'AAPL', name: 'Apple Inc.' },
        { symbol: 'MSFT', name: 'Microsoft Corporation' },
        { symbol: 'GOOGL', name: 'Alphabet Inc.' },
        { symbol: 'GOOG', name: 'Alphabet Inc. Class C' },
        { symbol: 'AMZN', name: 'Amazon.com Inc.' },
        { symbol: 'TSLA', name: 'Tesla Inc.' },
        { symbol: 'NVDA', name: 'NVIDIA Corporation' },
        { symbol: 'META', name: 'Meta Platforms Inc.' },
        { symbol: 'NFLX', name: 'Netflix Inc.' },
        { symbol: 'BTC-USD', name: 'Bitcoin USD' },
        { symbol: 'ETH-USD', name: 'Ethereum USD' },
        { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
        { symbol: 'JNJ', name: 'Johnson & Johnson' },
        { symbol: 'V', name: 'Visa Inc.' },
        { symbol: 'PG', name: 'Procter & Gamble Co.' },
        { symbol: 'BABA', name: 'Alibaba Group' },
        { symbol: 'DIS', name: 'The Walt Disney Company' },
        { symbol: 'PYPL', name: 'PayPal Holdings Inc.' },
        { symbol: 'INTC', name: 'Intel Corporation' },
        { symbol: 'AMD', name: 'Advanced Micro Devices' }
      ];
      
      const results = allStocks.filter(stock => 
        stock.symbol.toLowerCase().includes(query) ||
        stock.name.toLowerCase().includes(query)
      );
      
      res.json(results);
    });

    // Serve the HTML file
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      console.log(`Client ${clientId} connected from ${req.socket.remoteAddress}`);
      
      this.clients.set(clientId, {
        ws: ws,
        subscribedSymbols: new Set(),
        lastPing: Date.now()
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(clientId, data);
        } catch (error) {
          console.error('Invalid message from client:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid JSON message'
          }));
        }
      });

      ws.on('close', () => {
        console.log(`Client ${clientId} disconnected`);
        this.handleClientDisconnect(clientId);
      });

      ws.on('error', (error) => {
        console.error(`Client ${clientId} error:`, error);
        this.handleClientDisconnect(clientId);
      });

      // Send initial connection success message
      ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        clientId: clientId,
        timestamp: Date.now()
      }));
    });

    // Clean up dead connections every 30 seconds
    setInterval(() => {
      this.cleanupConnections();
    }, 30000);
  }

  handleClientMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    console.log(`Message from ${clientId}:`, data);

    switch (data.type) {
      case 'subscribe':
        this.handleSubscribe(clientId, data.symbols);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(clientId, data.symbols);
        break;
      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      default:
        client.ws.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${data.type}`
        }));
    }
  }

  handleSubscribe(clientId, symbols) {
    const client = this.clients.get(clientId);
    if (!client || !symbols || !Array.isArray(symbols)) {
      console.log('Invalid subscribe request from', clientId);
      return;
    }

    symbols.forEach(symbol => {
      client.subscribedSymbols.add(symbol);
      this.activeSymbols.add(symbol);
      
      // Initialize price if not exists
      if (!this.stockPrices.has(symbol)) {
        this.initializeStockPrice(symbol);
      }
    });

    // Send current prices immediately
    symbols.forEach(symbol => {
      const currentData = this.stockPrices.get(symbol);
      if (currentData) {
        client.ws.send(JSON.stringify({
          type: 'ticker',
          data: currentData
        }));
      }
    });

    console.log(`Client ${clientId} subscribed to:`, symbols);
    console.log(`Total active symbols:`, this.activeSymbols.size);
  }

  handleUnsubscribe(clientId, symbols) {
    const client = this.clients.get(clientId);
    if (!client || !symbols || !Array.isArray(symbols)) return;

    symbols.forEach(symbol => {
      client.subscribedSymbols.delete(symbol);
    });

    this.recalculateActiveSymbols();
    console.log(`Client ${clientId} unsubscribed from:`, symbols);
  }

  handleClientDisconnect(clientId) {
    this.clients.delete(clientId);
    this.recalculateActiveSymbols();
    console.log(`Active clients: ${this.clients.size}`);
  }

  recalculateActiveSymbols() {
    this.activeSymbols.clear();
    this.clients.forEach(client => {
      client.subscribedSymbols.forEach(symbol => {
        this.activeSymbols.add(symbol);
      });
    });
  }

  initializeStockPrice(symbol) {
    // Initialize with realistic base prices
    const basePrices = {
      'AAPL': 150,
      'MSFT': 300,
      'GOOGL': 2500,
      'GOOG': 2500,
      'AMZN': 3000,
      'TSLA': 800,
      'NVDA': 400,
      'META': 250,
      'NFLX': 400,
      'BTC-USD': 35000,
      'ETH-USD': 2000,
      'JPM': 140,
      'JNJ': 160,
      'V': 220,
      'PG': 140
    };

    const basePrice = basePrices[symbol] || (Math.random() * 200 + 50);
    const change = (Math.random() - 0.5) * basePrice * 0.05; // Max 5% change
    const price = Math.max(0.01, basePrice + change);
    
    this.stockPrices.set(symbol, {
      id: symbol,
      price: price,
      previousClose: basePrice,
      change: change,
      changePercent: (change / basePrice) * 100,
      dayHigh: price * (1 + Math.random() * 0.03),
      dayLow: price * (1 - Math.random() * 0.03),
      dayVolume: Math.floor(Math.random() * 50000000 + 1000000),
      time: Date.now(),
      currency: symbol.includes('USD') ? 'USD' : 'USD',
      exchange: symbol.includes('USD') ? 'CRYPTO' : 'NASDAQ'
    });
  }

  startPriceSimulation() {
    // Update prices every 2 seconds
    this.priceUpdateInterval = setInterval(() => {
      this.updatePrices();
    }, 2000);
  }

  updatePrices() {
    if (this.activeSymbols.size === 0) return;

    this.activeSymbols.forEach(symbol => {
      const currentData = this.stockPrices.get(symbol);
      if (!currentData) {
        this.initializeStockPrice(symbol);
        return;
      }

      // Generate realistic price movement
      const volatility = symbol.includes('USD') ? 0.02 : 0.01; // Crypto more volatile
      const changePercent = (Math.random() - 0.5) * volatility;
      const newPrice = Math.max(0.01, currentData.price * (1 + changePercent));
      const change = newPrice - currentData.previousClose;

      const updatedData = {
        ...currentData,
        price: newPrice,
        change: change,
        changePercent: (change / currentData.previousClose) * 100,
        dayHigh: Math.max(currentData.dayHigh, newPrice),
        dayLow: Math.min(currentData.dayLow, newPrice),
        dayVolume: currentData.dayVolume + Math.floor(Math.random() * 10000),
        time: Date.now()
      };

      this.stockPrices.set(symbol, updatedData);
      this.broadcastToClients(updatedData);
    });
  }

  broadcastToClients(tickerData) {
    const messageData = {
      type: 'ticker',
      data: tickerData
    };

    let sentCount = 0;
    this.clients.forEach((client, clientId) => {
      if (client.subscribedSymbols.has(tickerData.id)) {
        try {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(messageData));
            sentCount++;
          }
        } catch (error) {
          console.error(`Failed to send to client ${clientId}:`, error);
          this.clients.delete(clientId);
        }
      }
    });

    if (sentCount > 0) {
      console.log(`Sent ${tickerData.id} update to ${sentCount} clients: $${tickerData.price.toFixed(2)}`);
    }
  }

  cleanupConnections() {
    let removedCount = 0;
    this.clients.forEach((client, clientId) => {
      if (client.ws.readyState !== WebSocket.OPEN) {
        this.clients.delete(clientId);
        removedCount++;
      }
    });
    
    if (removedCount > 0) {
      console.log(`Cleaned up ${removedCount} dead connections`);
      this.recalculateActiveSymbols();
    }
  }

  generateClientId() {
    return 'client_' + Math.random().toString(36).substr(2, 9);
  }

  start(port = 3001) {
    this.server.listen(port, () => {
      console.log('=================================');
      console.log('Yahoo Finance Server Started!');
      console.log(`Server: http://localhost:${port}`);
      console.log(`WebSocket: ws://localhost:${port}`);
      console.log(`Health Check: http://localhost:${port}/health`);
      console.log('=================================');
    });
  }

  stop() {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }
    this.wss.close();
    this.server.close();
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  if (global.server) {
    global.server.stop();
  }
  process.exit(0);
});

// Start the server
const server = new YahooFinanceServer();
global.server = server;
server.start();

module.exports = YahooFinanceServer;