import { OnModuleInit } from '@nestjs/common';
export declare class CryptoService implements OnModuleInit {
    private masterKey;
    onModuleInit(): Promise<void>;
    encryptString(plaintext: string): string;
    decryptString(payload: string): string;
    isEncrypted(value: string): boolean;
    private loadOrCreateMasterKey;
}
