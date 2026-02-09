export type JobDefinitionInfo = {
    id: string;
    name: string;
    description: string;
    defaultScheduleCron?: string;
};
export declare const JOB_DEFINITIONS: JobDefinitionInfo[];
export declare function findJobDefinition(jobId: string): JobDefinitionInfo | undefined;
