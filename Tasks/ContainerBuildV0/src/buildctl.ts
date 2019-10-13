"use strict";

import tl = require('azure-pipelines-task-lib/task');
import path = require('path');
import * as toolLib from 'azure-pipelines-tool-lib/tool';
import utils = require("./utils");
import RegistryAuthenticationToken from "docker-common-v2/registryauthenticationprovider/registryauthenticationtoken";
import ContainerConnection from "docker-common-v2/containerconnection";
import { getDockerRegistryEndpointAuthenticationToken } from "docker-common-v2/registryauthenticationprovider/registryauthenticationtoken";

async function configureBuildctl() {
    var stableBuildKitVersion = await utils.getStableBuildctlVersion();
    var buildctlPath = await utils.downloadBuildctl(stableBuildKitVersion);

    // prepend the tools path. instructs the agent to prepend for future tasks
    if (!process.env['PATH'].startsWith(path.dirname(buildctlPath))) {
        toolLib.prependPath(path.dirname(buildctlPath));
    }
}

async function verifyBuildctl() {
    await configureBuildctl();
    tl.debug(tl.loc("VerifyBuildctlInstallation"));
    
    var buildctlToolPath = tl.which("buildctl", true);
    var buildctlTool = tl.tool(buildctlToolPath);
    
    buildctlTool.arg("--help");
    buildctlTool.exec();
}

export async function buildctlBuildAndPush() {

    await verifyBuildctl();

    await utils.getBuildKitPod();

    let tags = tl.getDelimitedInput("tags", "\n");
    let endpointId = tl.getInput("dockerRegistryServiceConnection");
    let registryAuthenticationToken: RegistryAuthenticationToken = getDockerRegistryEndpointAuthenticationToken(endpointId);

    // Connect to any specified container registry
    let connection = new ContainerConnection();
    connection.open(null, registryAuthenticationToken, true, false);
    let repositoryName = tl.getInput("repository");
    if (!repositoryName) {
        tl.warning("No repository is specified. Nothing will be pushed.");
    }

    let imageNames: string[] = [];
    if (tl.getInput("dockerRegistryServiceConnection")) {
        let imageName = connection.getQualifiedImageName(repositoryName, true);
        if (imageName) {
            imageNames.push(imageName);
        }
    }
    else {
        imageNames = connection.getQualifiedImageNamesFromConfig(repositoryName, true);
    }

    var contextarg = "--local=context="+tl.getInput("buildContext", true);
    var dockerfilearg = "--local=dockerfile="+tl.getInput("Dockerfile", true);
    var buildctlToolPath = tl.which("buildctl", true);
    var buildctlTool = tl.tool(buildctlToolPath);

    buildctlTool.arg("build");
    buildctlTool.arg('--frontend=dockerfile.v0');
    buildctlTool.arg(contextarg);
    buildctlTool.arg(dockerfilearg);
    if (imageNames && imageNames.length > 0) {
        imageNames.forEach(imageName => {
            if (tags && tags.length > 0) {
                tags.forEach(async tag => {
                    buildctlTool.arg(`--output=type=image,name=${imageName}:${tag},push=true`);
                    await buildctlTool.exec();
                })
            }
        })
    }
}