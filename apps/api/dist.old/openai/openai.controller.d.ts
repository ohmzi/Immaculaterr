import { OpenAiService } from './openai.service';
type TestOpenAiBody = {
    apiKey?: unknown;
};
export declare class OpenAiController {
    private readonly openAiService;
    constructor(openAiService: OpenAiService);
    test(body: TestOpenAiBody): Promise<{
        ok: boolean;
        meta: {
            count: number;
            sample: string[];
        };
    }>;
}
export {};
