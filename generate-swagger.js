import fs from 'fs';
import swaggerJsdoc from 'swagger-jsdoc';

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
        url: 'http://host.docker.internal:4000',
        description: 'Servidor de Desenvolvimento',
      }
    ],
  },
  apis: ['./routes/*.js'], 
};

const specs = swaggerJsdoc(options);
fs.writeFileSync('./swagger-spec.json', JSON.stringify(specs, null, 2));
console.log("Swagger spec generated successfully!");
