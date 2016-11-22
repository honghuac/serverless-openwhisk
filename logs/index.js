'use strict';

const BbPromise = require('bluebird');
const chalk = require('chalk');
const moment = require('moment');
const path = require('path');
const ClientFactory = require('../util/client_factory');

class OpenWhiskLogs {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('ibm');
    this.previous_activations = new Set()

    this.hooks = {
      'logs:logs': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.functionLogs)
    };
  }

  validate () {
  if (!this.serverless.config.servicePath) {
      throw new this.serverless.classes.Error('This command can only be run inside a service.');
    }

    this.serverless.service.getFunction(this.options.function);

    this.options.stage = this.options.stage
      || (this.serverless.service.defaults && this.serverless.service.defaults.stage)
      || 'dev';
    this.options.region = this.options.region
      || (this.serverless.service.defaults && this.serverless.service.defaults.region)
      || 'us-east-1';

    this.options.interval = this.options.interval || 1000;

    return ClientFactory.fromWskProps().then(client => {
      this.client = client;
    });
  }

  functionLogs () {
    return BbPromise.bind(this)
        .then(this.retrieveInvocationLogs)
        .then(this.filterFunctionLogs)
        .then(this.showFunctionLogs)
        .then(() => {
          if (this.options.tail) {
            this.timeout = setTimeout(() => {
              this.functionLogs()
            }, this.options.interval)
          }
        })
  }

  retrieveInvocationLogs () {
    const functionObject = this.serverless.service.getFunction(this.options.function);

    const options = {
      docs: true,
      limit: 100,
      namespace: '_'
    };

    return this.client.activations.list(options)
      .catch(err => {
        throw new this.serverless.classes.Error(
          `Failed to retrieve activation logs due to error:`
          + ` ${err.message}`
        );
      });
  }

  filterFunctionLogs (logs) {
    const functionObject = this.serverless.service.getFunction(this.options.function);
    const actionName = functionObject.name || `${this.serverless.service.service}_${this.options.function}`

    return BbPromise.resolve(logs.filter(log => log.name === actionName
      && !this.previous_activations.has(log.activationId)));
  }

  showFunctionLogs (logs) {
    if (!this.options.tail && !logs.length) {
      this.consoleLog(`There's no log data for function "${this.options.function}" available right now…`)
      return BbPromise.resolve();
    }

    logs.filter(log => log.logs.length)
      .reverse()
      .map((log, idx, arr) => {
        if (this.timeout && idx === 0) console.log('')

        this.previous_activations.add(log.activationId)
        this.consoleLog(this.formatActivationLine(log))
        log.logs.map(this.formatLogLine).forEach(this.consoleLog)

        if (idx != (arr.length - 1)) {
          this.consoleLog('')
        }
      })
    return BbPromise.resolve();
  }

  formatActivationLine (activation) {
    return `${chalk.blue('activation')} (${chalk.yellow(activation.activationId)}):`
  }

  formatLogLine (logLine) {
    const items = logLine.split(' ')
    const format = 'YYYY-MM-DD HH:mm:ss.SSS'
    const timestamp = chalk.green(moment(items[0]).format(format))

    let contents = items.slice(2).join(' ')
    if (items[1] === 'stderr:') {
      contents = chalk.red(contents)
    }

    return `${timestamp} ${contents}`
  }

  consoleLog(msg) {
    console.log(msg); // eslint-disable-line no-console
  }
}

module.exports = OpenWhiskLogs;