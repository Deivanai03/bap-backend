import { NextRequest, NextResponse } from 'next/server';

export async function OPTIONS() {
  return handleOptions();
}

export async function GET() {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>BAP API Documentation</title>
        <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.31.0/swagger-ui.css" />
        <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.31.0/favicon-32x32.png" sizes="32x32" />
        <style>
          html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
          *, *:before, *:after { box-sizing: inherit; }
          body { margin:0; background: #fafafa; }
          .swagger-ui .topbar { 
            display: flex !important;
            background: #89bf04;
            padding: 10px 0;
            position: relative;
          }
          .swagger-ui .topbar .download-url-wrapper { display: none; }
          
          /* Move theme toggle to top right */
          .swagger-ui .theme-toggle,
          .swagger-ui .topbar .theme-toggle,
          .swagger-ui button[title*="theme"],
          .swagger-ui button[aria-label*="theme"],
          .swagger-ui .topbar button:last-child {
            position: absolute !important;
            top: 15px !important;
            right: 20px !important;
            z-index: 1000 !important;
            margin: 0 !important;
          }
          
          /* Ensure topbar content doesn't overlap */
          .swagger-ui .topbar-wrapper {
            padding-right: 60px !important;
          }
        </style>
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://unpkg.com/swagger-ui-dist@5.31.0/swagger-ui-bundle.js"></script>
        <script src="https://unpkg.com/swagger-ui-dist@5.31.0/swagger-ui-standalone-preset.js"></script>
        <script>
          window.onload = function() {
            const ui = SwaggerUIBundle({
              url: '/api/docs/swagger.json',
              dom_id: '#swagger-ui',
              deepLinking: true,
              presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
              ],
              plugins: [
                SwaggerUIBundle.plugins.DownloadUrl
              ],
              layout: "StandaloneLayout",
              tryItOutEnabled: true,
              filter: true,
              supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
              docExpansion: 'list',
              defaultModelsExpandDepth: 1,
              defaultModelExpandDepth: 1,
              persistAuthorization: false,
              initOAuth: {
                clientId: null,
                clientSecret: null,
                realm: null,
                appName: null,
                scopeSeparator: " ",
                additionalQueryStringParams: {},
                useBasicAuthenticationWithAccessCodeGrant: false,
                usePkceWithAuthorizationCodeGrant: false
              }
            });
            
            // Clear any stored auth on page load
            ui.preauthorizeBasic = function() {};
            ui.preauthorizeApiKey = function() {};
            
            // Override auth storage
            const originalSetItem = localStorage.setItem;
            localStorage.setItem = function(key, value) {
              if (key.includes('swagger') || key.includes('auth') || key.includes('bearer')) {
                console.log('Blocked auth storage:', key);
                return;
              }
              originalSetItem.call(this, key, value);
            };
          };
        </script>
      </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
}
