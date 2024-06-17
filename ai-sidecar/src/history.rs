use std::fmt::Display;

mod headers {
    pub const SYSTEM: &str = "<|system|>\n";
    pub const USER: &str = "<|user|>\n";
    pub const ASSISTANT: &str = "<|assistant|>\n";
}

#[derive(Debug, Clone)]
pub struct Message {
    message_type: MessageType,
    content: String,
}

impl Message {
    pub fn get(&self) -> String {
        format!("{id}{msg}</s>\n", id = self.message_type, msg = self.content)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageType {
    System,
    User,
    Assistant,
}

impl Display for MessageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}",
            match self {
                Self::System => headers::SYSTEM,
                Self::User => headers::USER,
                Self::Assistant => headers::ASSISTANT,
            }
        )
    }
}

#[derive(Debug, Clone)]
pub struct History {
    pub system: Message,
    pub history: Vec<Message>,
}

impl History {
    pub fn new(system_content: String) -> Self {
        Self {
            system: Message {
                message_type: MessageType::System,
                content: system_content,
            },
            history: vec![
                Message {
                    message_type: MessageType::Assistant,
                    content: "Hello, how may I help you today?".into(),
                },
            ],
        }
    }

    #[inline(always)]
    fn get_inner(&self, mut prompt: String) -> String {
        for message in self.history.iter() {
            prompt += message.get().as_str();
        }
        prompt += headers::ASSISTANT.trim();

        tracing::debug!("{prompt}");

        prompt
    }

    pub fn get(&self) -> String {
        self.get_inner(self.system.get())
    }

    pub fn get_with_system(&self, system_content: String) -> String {
        self.get_inner(
            Message {
                message_type: MessageType::System,
                content: system_content,
            }
            .get(),
        )
    }

    pub fn push(&mut self, message_type: MessageType, content: String) {
        self.history.push(Message {
            message_type,
            content,
        });
    }

    pub fn clear(&mut self) {
        self.history.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display() {
        let mut prompt = History::new("Test input".into());
        prompt.push(MessageType::User, "User input".into());

        assert_eq!(
            prompt.get(),
            "<|system|>\nTest input\n<|user|>\nUser input\n<|assistant|>"
        );

        prompt.push(MessageType::Assistant, "Assistant input".into());

        assert_eq!(
            prompt.get(),
            "<|system|>\nTest input\n<|user|>\nUser input\n<|assistant|>\nAssistant input\n<|assistant|>"
        );
    }
}
