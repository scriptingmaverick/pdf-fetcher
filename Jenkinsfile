pipeline {
    agent {
        kubernetes {
            yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: jnlp
      image: jenkins/inbound-agent:latest-jdk17
      resources:
        limits:
          cpu: 1000m
          memory: 2Gi
        requests:
          cpu: 500m
          memory: 500Mi
      volumeMounts:
        - name: workspace-vol
          mountPath: /workspace
        - name: metrics-vol
          mountPath: /metrics

    - name: model-server
      image: ollama/ollama:latest
      env:
        - name: MODEL_SERVER_PROVIDER
          value: "ollama"
        - name: MODEL_NAME
          value: "qwen3.5:9b"
        - name: MODEL_SERVER_MODEL_ID
          value: "qwen3.5:9b"
        - name: MODEL_SERVER_BASE_URL
          value: "http://localhost:11434/v1"
      resources:
        limits:
          cpu: 4000m
          memory: 8Gi
        requests:
          cpu: 500m
          memory: 2Gi
      ports:
        - containerPort: 11434
      volumeMounts:
        - name: model-server-cache
          mountPath: /root/.ollama
        - name: workspace-vol
          mountPath: /workspace
        - name: metrics-vol
          mountPath: /metrics

    - name: coding-agent
      image: node:22-slim
      command: ["sh", "-c", "cat"]
      tty: true
      env:
        - name: NPM_CONFIG_PREFIX
          value: "/npm-global"
        - name: IS_SANDBOX
          value: "1"
        - name: MODEL_SERVER_PROVIDER
          value: "ollama"
        - name: MODEL_NAME
          value: "qwen3.5:9b"
        - name: MODEL_SERVER_MODEL_ID
          value: "qwen3.5:9b"
        - name: MODEL_SERVER_BASE_URL
          value: "http://localhost:11434/v1"
      resources:
        limits:
          cpu: 4000m
          memory: 8Gi
        requests:
          cpu: 1000m
          memory: 2Gi
      volumeMounts:
        - name: npm-global-cache
          mountPath: /npm-global
        - name: pi-memory-cache
          mountPath: /root/.pi
        - name: mise-data-cache
          mountPath: /root/.local/share/mise
        - name: mise-cache
          mountPath: /root/.cache/mise
        - name: workspace-vol
          mountPath: /workspace
        - name: metrics-vol
          mountPath: /metrics

  volumes:
    - name: npm-global-cache
      hostPath:
        path: /tmp/npm-global-cache
        type: DirectoryOrCreate
    - name: pi-memory-cache
      hostPath:
        path: /tmp/pi-memory-cache
        type: DirectoryOrCreate
    - name: mise-data-cache
      hostPath:
        path: /tmp/mise-data-cache
        type: DirectoryOrCreate
    - name: mise-cache
      hostPath:
        path: /tmp/mise-cache
        type: DirectoryOrCreate
    - name: model-server-cache
      hostPath:
        path: /tmp/model-server-cache
        type: DirectoryOrCreate
    - name: workspace-vol
      emptyDir: {}
    - name: metrics-vol
      emptyDir: {}
            """
            defaultContainer('jnlp')
        }
    }

    parameters {
        string(
            name: 'SEARCH_TEXT',
            defaultValue: '',
            description: 'Text to search for PDF documents on the internet'
        )
        string(
            name: 'MAX_RESULTS',
            defaultValue: '20',
            description: 'Maximum number of PDF links to collect'
        )
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        timestamps()
    }

    stages {
        stage('Wait for Ollama') {
            steps {
                container('model-server') {
                    sh '''
                        echo "Waiting for Ollama to be ready..."
                        for i in $(seq 1 12); do
                            if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
                                echo "Ollama is ready"
                                break
                            fi
                            echo "Waiting for Ollama... ($i/12)"
                            sleep 5
                        done
                        if ollama list | grep -q "${MODEL_NAME}"; then
                            echo "Model ${MODEL_NAME} already present, skipping pull."
                        else
                            MODEL_SERVER_PROVIDER="${MODEL_SERVER_PROVIDER}" \
                            MODEL_NAME="${MODEL_NAME}" \
                            MODEL_SERVER_MODEL_ID="${MODEL_SERVER_MODEL_ID}" \
                            ollama pull "${MODEL_NAME}"
                        fi
                    '''
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                container('coding-agent') {
                    sh '''
                        export PATH="/npm-global/bin:$PATH"
                        npm install
                    '''
                }
            }
        }

        stage('Search PDFs with Pi Agent') {
            steps {
                container('coding-agent') {
                    withEnv([
                        "SEARCH_TEXT=${SEARCH_TEXT}",
                        "MAX_RESULTS=${MAX_RESULTS}",
                        "MODEL_SERVER_BASE_URL=http://localhost:11434/v1",
                        "MODEL_SERVER_PROVIDER=ollama",
                        "MODEL_NAME=qwen3.5:9b",
                        "MODEL_SERVER_MODEL_ID=qwen3.5:9b",
                    ]) {
                        sh '''
                            export PATH="/npm-global/bin:$PATH"
                            node fetch-pdfs.mjs
                        '''
                    }
                }
            }
        }

        stage('Archive PDF Links') {
            steps {
                container('coding-agent') {
                    sh '''
                        if [ -f pdf-links.txt ] && [ -s pdf-links.txt ]; then
                            echo "PDF links found:"
                            cat pdf-links.txt
                        else
                            echo "No PDF links found. Creating empty artifact."
                            echo "No PDF links found for: ${SEARCH_TEXT}" > pdf-links.txt
                        fi
                    '''
                }
                archiveArtifacts(
                    artifacts: 'pdf-links.txt',
                    allowEmptyArchive: true,
                    fingerprint: true
                )
            }
        }
    }

    post {
        always {
            container('coding-agent') {
                sh 'echo "Pipeline completed. Artifact archived."'
            }
        }
        failure {
            echo 'Pipeline failed. Check the logs for details.'
        }
        success {
            echo 'Pipeline succeeded. PDF links archived as artifact.'
        }
    }
}
