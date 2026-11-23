import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API Minas Bahia',
      version: '1.0.0',
      description: 'Documentação da API principal do portal',
    },
    servers: [
      {
        url: 'http://localhost:4000',
        description: 'Servidor de Desenvolvimento',
      },
      {
        url: 'https://portal-capoeira-backend-b4hucqbpbfd3aubd.brazilsouth-01.azurewebsites.net',
        description: 'Servidor em Produção',
      }
    ],
  },
  // O Swagger vai procurar por comentários em todos os arquivos dentro de /routes
  apis: ['./routes/*.js'], 
};

const specs = swaggerJsdoc(options);

export const setupSwagger = (app) => {
  // A rota /api-docs exibirá a interface do Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
};
