#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

class AvalancheCLIMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "avalanche-cli-installer",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "check_compatibility",
          description: "Check if the current system is compatible with Avalanche CLI",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "install_avalanche_cli",
          description: "Install Avalanche CLI using the official installation script",
          inputSchema: {
            type: "object",
            properties: {
              force: {
                type: "boolean",
                description: "Force installation even if already installed",
                default: false,
              },
            },
          },
        },
        {
          name: "check_installation",
          description: "Check if Avalanche CLI is installed and get version information",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "setup_path",
          description: "Add Avalanche CLI to system PATH",
          inputSchema: {
            type: "object",
            properties: {
              shell: {
                type: "string",
                description: "Shell type (bash, zsh, fish)",
                enum: ["bash", "zsh", "fish"],
              },
            },
          },
        },
        {
          name: "get_installation_info",
          description: "Get detailed installation information and instructions",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "update_avalanche_cli",
          description: "Update Avalanche CLI to the latest version",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "build_from_source",
          description: "Get instructions for building Avalanche CLI from source",
          inputSchema: {
            type: "object",
            properties: {
              tag: {
                type: "string",
                description: "Git tag to checkout (optional)",
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "check_compatibility":
            return await this.checkCompatibility();
          
          case "install_avalanche_cli":
            return await this.installAvalancheCLI(args?.force || false);
          
          case "check_installation":
            return await this.checkInstallation();
          
          case "setup_path":
            return await this.setupPath(args?.shell);
          
          case "get_installation_info":
            return await this.getInstallationInfo();
          
          case "update_avalanche_cli":
            return await this.updateAvalancheCLI();
          
          case "build_from_source":
            return await this.getBuildFromSourceInfo(args?.tag);
          
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(ErrorCode.InternalError, errorMessage);
      }
    });
  }

  private async checkCompatibility() {
    const platform = os.platform();
    const arch = os.arch();
    
    const isCompatible = platform === 'linux' || platform === 'darwin';
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            compatible: isCompatible,
            platform: platform,
            architecture: arch,
            message: isCompatible 
              ? "Your system is compatible with Avalanche CLI"
              : "Avalanche CLI currently supports Linux and macOS only. Windows is not supported.",
          }, null, 2),
        },
      ],
    };
  }

  private async installAvalancheCLI(force: boolean = false) {
    try {
      // Check compatibility first
      const platform = os.platform();
      if (platform !== 'linux' && platform !== 'darwin') {
        throw new Error("Avalanche CLI is not supported on this platform. Only Linux and macOS are supported.");
      }

      // Check if already installed (unless force is true)
      if (!force) {
        try {
          await execAsync('which avalanche');
          return {
            content: [
              {
                type: "text",
                text: "Avalanche CLI is already installed. Use 'force: true' to reinstall or use the update tool.",
              },
            ],
          };
        } catch {
          // Not installed, proceed with installation
        }
      }

      // Create ~/bin directory if it doesn't exist
      const homeDir = os.homedir();
      const binDir = path.join(homeDir, 'bin');
      
      try {
        await fs.access(binDir);
      } catch {
        await fs.mkdir(binDir, { recursive: true });
      }

      // Run the installation script
      const installCommand = 'curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s';
      const { stdout, stderr } = await execAsync(installCommand);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Avalanche CLI installed successfully",
              stdout: stdout,
              stderr: stderr,
              next_steps: [
                "Add ~/bin to your PATH if not already done",
                "Run 'avalanche --version' to verify installation"
              ]
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  private async checkInstallation() {
    try {
      const { stdout: versionOutput } = await execAsync('avalanche --version');
      const { stdout: whichOutput } = await execAsync('which avalanche');
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              installed: true,
              version: versionOutput.trim(),
              path: whichOutput.trim(),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              installed: false,
              error: "Avalanche CLI not found in PATH",
              suggestion: "Run the install_avalanche_cli tool to install it",
            }, null, 2),
          },
        ],
      };
    }
  }

  private async setupPath(shell?: string) {
    const homeDir = os.homedir();
    const binPath = path.join(homeDir, 'bin');
    
    // Detect shell if not provided
    if (!shell) {
      shell = path.basename(process.env.SHELL || 'bash');
    }

    const shellConfigs = {
      bash: '.bashrc',
      zsh: '.zshrc',
      fish: '.config/fish/config.fish',
    };

    const configFile = shellConfigs[shell as keyof typeof shellConfigs];
    if (!configFile) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Unsupported shell: ${shell}`,
              supported_shells: Object.keys(shellConfigs),
            }, null, 2),
          },
        ],
      };
    }

    const configPath = path.join(homeDir, configFile);
    const exportLine = shell === 'fish' 
      ? `set -gx PATH ~/bin $PATH`
      : `export PATH=~/bin:$PATH`;

    try {
      // Check if PATH is already set
      let configContent = '';
      try {
        configContent = await fs.readFile(configPath, 'utf-8');
      } catch {
        // File doesn't exist, will be created
      }

      if (configContent.includes('~/bin') || configContent.includes(binPath)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "PATH already contains ~/bin directory",
                current_config: configPath,
              }, null, 2),
            },
          ],
        };
      }

      // Add export line to config file
      await fs.appendFile(configPath, `\n# Added by Avalanche CLI MCP Server\n${exportLine}\n`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Added ~/bin to PATH in ${configPath}`,
              instruction: `Restart your terminal or run 'source ${configPath}' to apply changes`,
              added_line: exportLine,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  private async getInstallationInfo() {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            title: "Avalanche CLI Installation Guide",
            compatibility: {
              supported_os: ["Linux", "macOS"],
              unsupported_os: ["Windows"],
            },
            installation: {
              command: "curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s",
              install_location: "~/bin/avalanche",
              description: "Downloads and installs the latest binary release"
            },
            path_setup: {
              bash: "export PATH=~/bin:$PATH >> ~/.bashrc",
              zsh: "export PATH=~/bin:$PATH >> ~/.zshrc",
              fish: "set -gx PATH ~/bin $PATH >> ~/.config/fish/config.fish"
            },
            verification: {
              command: "avalanche --version",
              description: "Check installation and version"
            },
            updating: {
              method: "Delete current binary and reinstall",
              description: "No built-in update mechanism"
            },
            source_build: {
              repository: "https://github.com/ava-labs/avalanche-cli",
              build_script: "./scripts/build.sh",
              output_binary: "./bin/avalanche"
            }
          }, null, 2),
        },
      ],
    };
  }

  private async updateAvalancheCLI() {
    try {
      const homeDir = os.homedir();
      const binPath = path.join(homeDir, 'bin', 'avalanche');

      // Check if currently installed
      try {
        await fs.access(binPath);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "Avalanche CLI not found at ~/bin/avalanche",
                suggestion: "Use install_avalanche_cli tool to install it first",
              }, null, 2),
            },
          ],
        };
      }

      // Get current version
      let currentVersion = '';
      try {
        const { stdout } = await execAsync('avalanche --version');
        currentVersion = stdout.trim();
      } catch {
        currentVersion = 'unknown';
      }

      // Remove current binary
      await fs.unlink(binPath);

      // Reinstall
      const installCommand = 'curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s';
      const { stdout, stderr } = await execAsync(installCommand);

      // Get new version
      let newVersion = '';
      try {
        const { stdout } = await execAsync('avalanche --version');
        newVersion = stdout.trim();
      } catch {
        newVersion = 'unknown';
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Avalanche CLI updated successfully",
              previous_version: currentVersion,
              new_version: newVersion,
              stdout: stdout,
              stderr: stderr,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  private async getBuildFromSourceInfo(tag?: string) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            title: "Building Avalanche CLI from Source",
            repository: "https://github.com/ava-labs/avalanche-cli",
            steps: [
              "Clone the repository: git clone https://github.com/ava-labs/avalanche-cli.git",
              "Navigate to the directory: cd avalanche-cli",
              tag ? `Checkout specific tag: git checkout ${tag}` : "Checkout desired tag: git checkout <tag>",
              "Build the binary: ./scripts/build.sh",
              "Binary will be available at: ./bin/avalanche"
            ],
            commands: [
              "git clone https://github.com/ava-labs/avalanche-cli.git",
              "cd avalanche-cli",
              tag ? `git checkout ${tag}` : "git checkout <desired-tag>",
              "./scripts/build.sh"
            ],
            output: {
              binary_location: "./bin/avalanche",
              description: "The compiled binary will be named 'avalanche' in the bin directory"
            },
            note: "Building from source allows you to use specific versions or contribute to development"
          }, null, 2),
        },
      ],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Avalanche CLI MCP server running on stdio");
  }
}

const server = new AvalancheCLIMCPServer();
server.run().catch(console.error);