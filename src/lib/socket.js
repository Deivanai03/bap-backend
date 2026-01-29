const { Server: SocketIOServer } = require('socket.io');

function initializeSocket(httpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Simple authentication middleware (for now)
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication token required'));
    }
    
    // For now, just store the token - full auth will be handled by API endpoints
    socket.auth = { token };
    next();
  });

  io.on('connection', (socket) => {
    console.log('User connected');

    // Join chat rooms
    socket.on('join-chat', (chatId) => {
      socket.join(`chat:${chatId}`);
      console.log(`User joined chat: ${chatId}`);
    });

    socket.on('leave-chat', (chatId) => {
      socket.leave(`chat:${chatId}`);
      console.log(`User left chat: ${chatId}`);
    });

    // Handle new messages
    socket.on('message', (data) => {
      socket.to(`chat:${data.chatId}`).emit('new-message', {
        ...data,
        timestamp: new Date().toISOString()
      });
    });

    // Handle typing indicators
    socket.on('typing', (data) => {
      socket.to(`chat:${data.chatId}`).emit('user-typing', {
        isTyping: data.isTyping
      });
    });

    // Test broadcast
    socket.on('test-broadcast', (data) => {
      io.emit('test-message', {
        message: data.message,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('disconnect', () => {
      console.log('User disconnected');
    });
  });

  return io;
}

module.exports = { initializeSocket };
