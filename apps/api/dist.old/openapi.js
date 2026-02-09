"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const app_module_1 = require("./app.module");
const bootstrap_env_1 = require("./bootstrap-env");
async function generateOpenApi() {
    await (0, bootstrap_env_1.ensureBootstrapEnv)();
    process.env.SCHEDULER_ENABLED = 'false';
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { logger: false });
    app.setGlobalPrefix('api');
    const config = new swagger_1.DocumentBuilder()
        .setTitle('Immaculaterr API')
        .setDescription('Local API for the Immaculaterr webapp.')
        .setVersion('0.0.0')
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    const defaultOutPath = (0, node_path_1.join)(__dirname, '..', 'openapi.json');
    const outPath = process.env.OPENAPI_OUTPUT?.trim() || defaultOutPath;
    await (0, promises_1.writeFile)(outPath, JSON.stringify(document, null, 2), 'utf8');
    await app.close();
}
generateOpenApi().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=openapi.js.map