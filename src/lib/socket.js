require('dotenv').config();
const { Server: SocketIOServer } = require('socket.io');
const { jwtVerify } = require('jose');
const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const { eq, and, sql } = require('drizzle-orm');

// Database connection for socket operations
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
});
const db = drizzle(pool);

// Store online users: Map<userId, Set<socketId>>
const onlineUsers = new Map();
// Store user-to-socket mapping for direct messaging
const userSockets = new Map();
// Store typing status
const typingUsers = new Map();

// JWT secret
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

async function verifySocketToken(token) {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

function initializeSocket(httpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling'],
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    const payload = await verifySocketToken(token);
    if (!payload) {
      return next(new Error('Invalid authentication token'));
    }

    socket.user = {
      userId: payload.userId,
      orgId: payload.orgId,
      email: payload.email,
      role: payload.role,
      sessionToken: payload.sessionToken,
    };
    next();
  });

  io.on('connection', async (socket) => {
    const { userId, orgId } = socket.user;
    console.log(`User connected: ${userId}`);

    // Track online user
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);
    userSockets.set(socket.id, userId);

    // Update user online status in database
    try {
      await pool.query(
        `UPDATE users SET online_status = 'online', last_seen = NOW() WHERE id = $1`,
        [userId]
      );
    } catch (err) {
      console.error('Failed to update online status:', err);
    }

    // Notify others that user is online
    socket.broadcast.emit('user:online', { userId, timestamp: new Date().toISOString() });

    // Join organization room for org-wide broadcasts
    socket.join(`org:${orgId}`);

    // ==================== CHAT EVENTS ====================

    socket.on('chat:join', async (data) => {
      const { chatId } = data;
      if (!chatId) return;

      socket.join(`chat:${chatId}`);
      console.log(`User ${userId} joined chat: ${chatId}`);

      // Notify others in chat that user joined
      socket.to(`chat:${chatId}`).emit('user:joined', {
        chatId,
        userId,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('chat:leave', async (data) => {
      const { chatId } = data;
      if (!chatId) return;

      socket.leave(`chat:${chatId}`);
      console.log(`User ${userId} left chat: ${chatId}`);

      // Clear typing status
      const typingKey = `${chatId}:${userId}`;
      if (typingUsers.has(typingKey)) {
        typingUsers.delete(typingKey);
        socket.to(`chat:${chatId}`).emit('typing:stop', { chatId, userId });
      }
    });

    socket.on('chat:read', async (data) => {
      const { chatId } = data;
      if (!chatId) return;

      try {
        // Reset unread count for user in this chat
        await pool.query(
          `UPDATE chat_participants SET unread_count = 0 WHERE chat_id = $1 AND user_id = $2`,
          [chatId, userId]
        );

        // Notify chat room
        socket.to(`chat:${chatId}`).emit('chat:read', { chatId, userId });
      } catch (err) {
        console.error('Failed to mark chat as read:', err);
      }
    });

    // ==================== MESSAGE EVENTS ====================

    socket.on('message:send', async (data, callback) => {
      const { chatId, content, attachments, replyTo } = data;

      if (!chatId || !content) {
        if (callback) callback({ error: 'Chat ID and content are required' });
        return;
      }

      try {
        // Verify user has access to chat
        const participantResult = await pool.query(
          `SELECT cp.id FROM chat_participants cp
           INNER JOIN chats c ON cp.chat_id = c.id
           WHERE cp.chat_id = $1 AND cp.user_id = $2 AND c.org_id = $3`,
          [chatId, userId, orgId]
        );

        if (participantResult.rows.length === 0) {
          if (callback) callback({ error: 'Access denied to this chat' });
          return;
        }

        // Create message
        const messageResult = await pool.query(
          `INSERT INTO messages (chat_id, sender_id, content, message_type, metadata, reply_to)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, chat_id, sender_id, content, message_type, metadata, reply_to, created_at`,
          [chatId, userId, content, 'text', attachments ? JSON.stringify({ attachments }) : null, replyTo || null]
        );

        const message = messageResult.rows[0];

        // Update chat's last_message_at
        await pool.query(
          `UPDATE chats SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [chatId]
        );

        // Increment unread count for other participants
        await pool.query(
          `UPDATE chat_participants SET unread_count = unread_count + 1
           WHERE chat_id = $1 AND user_id != $2`,
          [chatId, userId]
        );

        // Get sender info
        const senderResult = await pool.query(
          `SELECT id, email, full_name, avatar_url FROM users WHERE id = $1`,
          [userId]
        );
        const sender = senderResult.rows[0];

        const messageData = {
          id: message.id,
          chatId: message.chat_id,
          content: message.content,
          messageType: message.message_type,
          attachments: message.metadata?.attachments || attachments || [],
          replyTo: message.reply_to,
          createdAt: message.created_at,
          status: 'sent',
          sender: {
            id: sender.id,
            name: sender.full_name,
            email: sender.email,
            avatar: sender.avatar_url
          }
        };

        // Emit to all in chat room (including sender for confirmation)
        io.to(`chat:${chatId}`).emit('message:new', messageData);

        // Clear typing indicator
        const typingKey = `${chatId}:${userId}`;
        if (typingUsers.has(typingKey)) {
          typingUsers.delete(typingKey);
          socket.to(`chat:${chatId}`).emit('typing:stop', { chatId, userId });
        }

        if (callback) callback({ success: true, message: messageData });
      } catch (err) {
        console.error('Failed to send message:', err);
        if (callback) callback({ error: 'Failed to send message' });
      }
    });

    socket.on('message:delivered', async (data) => {
      const { messageId, chatId } = data;
      if (!messageId || !chatId) return;

      try {
        // Get message sender
        const result = await pool.query(
          `SELECT sender_id FROM messages WHERE id = $1`,
          [messageId]
        );

        if (result.rows.length > 0) {
          const senderId = result.rows[0].sender_id;

          // Notify sender that message was delivered
          io.to(`chat:${chatId}`).emit('message:status', {
            messageId,
            chatId,
            status: 'delivered',
            userId
          });
        }
      } catch (err) {
        console.error('Failed to mark message delivered:', err);
      }
    });

    socket.on('message:read', async (data) => {
      const { messageId, chatId } = data;
      if (!messageId || !chatId) return;

      try {
        // Notify chat that message was read
        io.to(`chat:${chatId}`).emit('message:status', {
          messageId,
          chatId,
          status: 'read',
          userId
        });
      } catch (err) {
        console.error('Failed to mark message read:', err);
      }
    });

    // ==================== TYPING EVENTS ====================

    socket.on('typing:start', async (data) => {
      const { chatId } = data;
      if (!chatId) return;

      const typingKey = `${chatId}:${userId}`;
      typingUsers.set(typingKey, Date.now());

      // Get user name for typing indicator
      let userName = 'Someone';
      try {
        const userResult = await pool.query(
          `SELECT full_name FROM users WHERE id = $1`,
          [userId]
        );
        if (userResult.rows.length > 0) {
          userName = userResult.rows[0].full_name || 'Someone';
        }
      } catch (err) {
        console.error('Failed to get user name for typing:', err);
      }

      socket.to(`chat:${chatId}`).emit('typing:start', { chatId, userId, userName });
    });

    socket.on('typing:stop', (data) => {
      const { chatId } = data;
      if (!chatId) return;

      const typingKey = `${chatId}:${userId}`;
      typingUsers.delete(typingKey);

      socket.to(`chat:${chatId}`).emit('typing:stop', { chatId, userId });
    });

    // ==================== CALL EVENTS ====================

    socket.on('call:initiate', async (data) => {
      const { chatId, callType, targetUserId } = data;
      if (!chatId || !callType || !targetUserId) return;

      try {
        // Create call record
        const callResult = await pool.query(
          `INSERT INTO calls (org_id, caller_id, callee_id, call_type, status)
           VALUES ($1, $2, $3, $4, 'ringing')
           RETURNING id`,
          [orgId, userId, targetUserId, callType]
        );

        const callId = callResult.rows[0].id;

        // Get caller info
        const callerResult = await pool.query(
          `SELECT id, email, full_name, avatar_url FROM users WHERE id = $1`,
          [userId]
        );
        const caller = callerResult.rows[0];

        // Notify target user
        const targetSockets = [];
        if (onlineUsers.has(targetUserId)) {
          onlineUsers.get(targetUserId).forEach(socketId => {
            targetSockets.push(socketId);
          });
        }

        targetSockets.forEach(socketId => {
          io.to(socketId).emit('call:incoming', {
            callId,
            chatId,
            callType,
            callerId: caller.id,
            callerName: caller.full_name,
            callerAvatar: caller.avatar_url,
            callerEmail: caller.email
          });
        });
      } catch (err) {
        console.error('Failed to initiate call:', err);
      }
    });

    socket.on('call:accept', async (data) => {
      const { chatId, callerId } = data;
      if (!chatId || !callerId) return;

      try {
        // Update call status
        await pool.query(
          `UPDATE calls SET status = 'active', started_at = NOW()
           WHERE caller_id = $1 AND callee_id = $2 AND status = 'ringing'`,
          [callerId, userId]
        );

        // Notify caller
        const callerSockets = onlineUsers.get(callerId);
        if (callerSockets) {
          callerSockets.forEach(socketId => {
            io.to(socketId).emit('call:accepted', { chatId, acceptedBy: userId });
          });
        }
      } catch (err) {
        console.error('Failed to accept call:', err);
      }
    });

    socket.on('call:reject', async (data) => {
      const { chatId, callerId, reason } = data;
      if (!chatId || !callerId) return;

      try {
        // Update call status
        await pool.query(
          `UPDATE calls SET status = 'declined', ended_at = NOW()
           WHERE caller_id = $1 AND callee_id = $2 AND status = 'ringing'`,
          [callerId, userId]
        );

        // Notify caller
        const callerSockets = onlineUsers.get(callerId);
        if (callerSockets) {
          callerSockets.forEach(socketId => {
            io.to(socketId).emit('call:rejected', { chatId, rejectedBy: userId, reason });
          });
        }
      } catch (err) {
        console.error('Failed to reject call:', err);
      }
    });

    socket.on('call:end', async (data) => {
      const { chatId, targetUserId } = data;
      if (!chatId || !targetUserId) return;

      try {
        // Update call status
        await pool.query(
          `UPDATE calls SET status = 'ended', ended_at = NOW(),
           duration = EXTRACT(EPOCH FROM (NOW() - started_at))::integer
           WHERE ((caller_id = $1 AND callee_id = $2) OR (caller_id = $2 AND callee_id = $1))
           AND status = 'active'`,
          [userId, targetUserId]
        );

        // Notify other party
        const targetSockets = onlineUsers.get(targetUserId);
        if (targetSockets) {
          targetSockets.forEach(socketId => {
            io.to(socketId).emit('call:ended', { chatId, endedBy: userId });
          });
        }
      } catch (err) {
        console.error('Failed to end call:', err);
      }
    });

    // ==================== WEBRTC SIGNALING ====================

    socket.on('webrtc:offer', (data) => {
      const { targetUserId, offer, chatId } = data;
      if (!targetUserId || !offer) return;

      const targetSockets = onlineUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('webrtc:offer', {
            offer,
            chatId,
            fromUserId: userId
          });
        });
      }
    });

    socket.on('webrtc:answer', (data) => {
      const { targetUserId, answer, chatId } = data;
      if (!targetUserId || !answer) return;

      const targetSockets = onlineUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('webrtc:answer', {
            answer,
            chatId,
            fromUserId: userId
          });
        });
      }
    });

    socket.on('webrtc:ice-candidate', (data) => {
      const { targetUserId, candidate, chatId } = data;
      if (!targetUserId || !candidate) return;

      const targetSockets = onlineUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('webrtc:ice-candidate', {
            candidate,
            chatId,
            fromUserId: userId
          });
        });
      }
    });

    // ==================== DISCONNECT ====================

    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${userId}`);

      // Remove socket from online users
      if (onlineUsers.has(userId)) {
        onlineUsers.get(userId).delete(socket.id);
        if (onlineUsers.get(userId).size === 0) {
          onlineUsers.delete(userId);

          // Update user status to offline in database
          try {
            await pool.query(
              `UPDATE users SET online_status = 'offline', last_seen = NOW() WHERE id = $1`,
              [userId]
            );
          } catch (err) {
            console.error('Failed to update offline status:', err);
          }

          // Notify others that user is offline
          socket.broadcast.emit('user:offline', {
            userId,
            lastSeen: new Date().toISOString()
          });
        }
      }

      userSockets.delete(socket.id);

      // Clear typing indicators
      for (const [key, _] of typingUsers) {
        if (key.endsWith(`:${userId}`)) {
          const chatId = key.split(':')[0];
          typingUsers.delete(key);
          socket.to(`chat:${chatId}`).emit('typing:stop', { chatId, userId });
        }
      }
    });
  });

  // Cleanup stale typing indicators every 10 seconds
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of typingUsers) {
      if (now - timestamp > 5000) {
        const [chatId, usrId] = key.split(':');
        typingUsers.delete(key);
        io.to(`chat:${chatId}`).emit('typing:stop', { chatId, userId: usrId });
      }
    }
  }, 10000);

  return io;
}

module.exports = { initializeSocket };
