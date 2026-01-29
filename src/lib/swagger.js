import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'BAP Backend API',
      version: '2.0.0',
      description: 'Business Asset Platform - Multi-tenant SaaS API with enterprise-grade security (OpenAPI 3.1.0)',
      contact: {
        name: 'BAP Team',
        email: 'dev@bap.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server'
      },
      {
        url: 'https://api.bap.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token obtained from magic link verification'
        }
      },
      schemas: {
        ApiResponse: {
          type: 'object',
          properties: {
            success: { 
              type: 'boolean',
              description: 'Indicates if the request was successful'
            },
            data: { 
              type: 'object',
              description: 'Response data payload'
            },
            meta: {
              type: 'object',
              properties: {
                request_id: { 
                  type: 'string',
                  description: 'Unique request identifier for tracing'
                },
                timestamp: { 
                  type: 'string', 
                  format: 'date-time',
                  description: 'Response timestamp in ISO format'
                }
              }
            },
            errors: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of error messages (empty if success=true)'
            }
          },
          required: ['success', 'data', 'meta', 'errors']
        },
        Error: {
          type: 'object',
          properties: {
            success: { 
              type: 'boolean',
              const: false
            },
            errors: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1
            },
            meta: {
              type: 'object',
              properties: {
                request_id: { type: 'string' },
                timestamp: { type: 'string', format: 'date-time' }
              }
            }
          }
        },
        Plan: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            slug: { type: 'string' },
            display_name: { type: 'string' },
            description: { type: 'string' },
            tier: { type: 'string', enum: ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'] },
            billing_period: { type: 'string', enum: ['monthly', 'yearly'] },
            features: { type: 'object' },
            limits: { type: 'object' }
          }
        },
        Subscription: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            plan: { $ref: '#/components/schemas/Plan' },
            status: { type: 'string', enum: ['active', 'canceled', 'past_due'] },
            current_period_start: { type: 'string', format: 'date-time' },
            current_period_end: { type: 'string', format: 'date-time' },
            amount_incl_tax: { type: 'number' },
            currency: { type: 'string' }
          }
        },
        Invoice: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            invoice_number: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'open', 'paid', 'void'] },
            total: { type: 'number' },
            currency: { type: 'string' },
            issued_at: { type: 'string', format: 'date-time' }
          }
        },
        PaymentMethod: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string' },
            card_brand: { type: 'string' },
            card_last4: { type: 'string' },
            is_default: { type: 'boolean' }
          }
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['owner', 'admin', 'member'] },
            status: { type: 'string', enum: ['active', 'inactive', 'pending'] }
          }
        },
        Organization: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            billing_country: { type: 'string' },
            tax_id: { type: 'string' }
          }
        },
        UserSession: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            user_id: { type: 'string', format: 'uuid' },
            session_token: { type: 'string' },
            expires_at: { type: 'string', format: 'date-time' },
            is_active: { type: 'boolean' }
          }
        },
        AuditEvent: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            org_id: { type: 'string', format: 'uuid' },
            event_type: { type: 'string' },
            event_category: { type: 'string' },
            actor_type: { type: 'string' },
            action: { type: 'string' },
            description: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        UsageTracking: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            org_id: { type: 'string', format: 'uuid' },
            metric_name: { type: 'string' },
            metric_value: { type: 'number' },
            period_start: { type: 'string', format: 'date' },
            period_end: { type: 'string', format: 'date' }
          }
        }
      }
    },
    tags: [
      { 
        name: 'Authentication', 
        description: 'Magic link authentication endpoints' 
      },
      { 
        name: 'Plans', 
        description: 'Subscription plans and pricing' 
      },
      { 
        name: 'Usage', 
        description: 'Usage metrics and plan limits' 
      },
      { 
        name: 'Billing', 
        description: 'Invoices and payment methods' 
      },
      { 
        name: 'Subscriptions', 
        description: 'Subscription management' 
      },
      { 
        name: 'Webhooks', 
        description: 'External webhook endpoints' 
      },
      {
        name: 'Chats',
        description: 'Chat management and messaging'
      },
      {
        name: 'Messages',
        description: 'Message operations and search'
      },
      {
        name: 'Labels',
        description: 'Chat labeling and organization'
      },
      {
        name: 'Files',
        description: 'File upload and management'
      },
      {
        name: 'Users',
        description: 'User management and profiles'
      },
      {
        name: 'Input Agent',
        description: 'AI input processing and voice transcription'
      },
      {
        name: 'Calls',
        description: 'Voice and video call management'
      },
      {
        name: 'WebSocket',
        description: 'WebSocket testing and real-time features'
      }
    ]
  },
  apis: ['./src/app/api/**/*.ts']
};

export const specs = swaggerJsdoc(options);
