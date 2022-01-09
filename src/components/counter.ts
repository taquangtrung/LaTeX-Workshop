import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as cp from 'child_process'

import type {Extension} from '../main'

export class Counter {
    private readonly extension: Extension
    private disableCountAfterSave: boolean = false

    constructor(extension: Extension) {
        this.extension = extension
    }

    async countOnSaveIfEnabled(file: string) {
        const configuration = vscode.workspace.getConfiguration('latex-workshop')
        if (configuration.get('texcount.autorun') as string !== 'onSave') {
            return
        }
        if (this.disableCountAfterSave) {
            this.extension.logger.addLogMessage('Auto texcount is temporarily disabled during a second.')
            return
        }
        this.extension.logger.addLogMessage(`Auto texcount started on saving file: ${file}`)
        this.disableCountAfterSave = true
        setTimeout(() => this.disableCountAfterSave = false, configuration.get('texcount.autorun.interval', 1000) as number)
        if (this.extension.manager.rootFile === undefined) {
            await this.extension.manager.findRoot()
        }
        if (this.extension.manager.rootFile === undefined) {
            this.extension.logger.addLogMessage('Cannot find root file')
            return
        }
        this.count(this.extension.manager.rootFile)
    }

    count(file: string, merge: boolean = true) {
        const configuration = vscode.workspace.getConfiguration('latex-workshop')
        const args = configuration.get('texcount.args') as string[]
        if (merge) {
            args.push('-merge')
        }
        let command = configuration.get('texcount.path') as string
        if (configuration.get('docker.enabled')) {
            this.extension.logger.addLogMessage('Use Docker to invoke the command.')
            if (process.platform === 'win32') {
                command = path.resolve(this.extension.extensionRoot, './scripts/texcount.bat')
            } else {
                command = path.resolve(this.extension.extensionRoot, './scripts/texcount')
                fs.chmodSync(command, 0o755)
            }
        }
        const proc = cp.spawn(command, args.concat([path.basename(file)]), {cwd: path.dirname(file)})
        proc.stdout.setEncoding('utf8')
        proc.stderr.setEncoding('utf8')

        let stdout = ''
        proc.stdout.on('data', newStdout => {
            stdout += newStdout
        })

        let stderr = ''
        proc.stderr.on('data', newStderr => {
            stderr += newStderr
        })

        proc.on('error', err => {
            this.extension.logger.addLogMessage(`Cannot count words: ${err.message}, ${stderr}`)
            void this.extension.logger.showErrorMessage('TeXCount failed. Please refer to LaTeX Workshop Output for details.')
        })

        proc.on('exit', exitCode => {
            if (exitCode !== 0) {
                this.extension.logger.addLogMessage(`Cannot count words, code: ${exitCode}, ${stderr}`)
                void this.extension.logger.showErrorMessage('TeXCount failed. Please refer to LaTeX Workshop Output for details.')
            } else {
                const words = /Words in text: ([0-9]*)/g.exec(stdout)
                const floats = /Number of floats\/tables\/figures: ([0-9]*)/g.exec(stdout)
                if (words) {
                    let floatMsg = ''
                    if (floats && parseInt(floats[1]) > 0) {
                        floatMsg = `and ${floats[1]} float${parseInt(floats[1]) > 1 ? 's' : ''} (tables, figures, etc.) `
                    }
                    void vscode.window.showInformationMessage(`There are ${words[1]} words ${floatMsg}in the ${merge ? 'LaTeX project' : 'opened LaTeX file'}.`)
                }
                let msg: string
                if (stdout === '') {
                    msg = ''
                } else {
                    msg = '\n' + stdout
                }
                this.extension.logger.addLogMessage(`TeXCount log:${msg}`)
            }
        })
    }
}
